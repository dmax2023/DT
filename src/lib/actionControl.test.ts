import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import type { AutoSnapshot } from "./autoSimulation";
import { simularAcao, validarAcao, type ActionConfig } from "./actionSimulation";

type Fonte = { producao: number[]; consumo?: (number | null)[] };

function fixture({ e0 = 50, p = 100, consumo = 0, h = 6, min = 0, max = 100 } = {}): AutoSnapshot {
  const trajetoria = [{ dia: 0, estoque: e0 }];
  for (let dia = 1; dia <= h; dia++) trajetoria.push({ dia, estoque: e0 + dia * (p - consumo) });
  return {
    tipo: "auto",
    geradoEm: "2026-11-07T00:00:00.000Z",
    workCenter: "CENTRO TESTE",
    horizonte: h,
    estoqueAtual: e0,
    estoqueMinimo: min,
    estoqueMaximo: max,
    preAlertaInferior: min + (max - min) * 0.2,
    preAlertaSuperior: max - (max - min) * 0.2,
    producaoRef: p,
    producaoMin: 0,
    producaoMax: p * 2,
    producaoAtual: p,
    ultimoDadoProducao: "2026-11-06",
    consumoAtivo: true,
    consumoRef: consumo,
    janelaConsumo: 30,
    saldoLiquido: p - consumo,
    trajetoria,
    estadoEstoque: "ADEQUADO",
    estadoProducao: "ADEQUADA",
    diaEvento: null,
    evento: "",
    recomendacao: "",
  };
}

function config(parcial: Record<string, unknown> = {}): ActionConfig {
  return {
    ajustePercentual: 0,
    diaInicio: 0,
    validarOperacional: false,
    producaoMinima: 0,
    producaoMaxima: 0,
    ...parcial,
  } as ActionConfig;
}

function simular(base: AutoSnapshot, parcial: Record<string, unknown> = {}, fonte?: Fonte) {
  const r = simularAcao(base, config(parcial), fonte);
  assert.ok(r);
  return r;
}

const unidades = (consumoUnidades: number) => ({ consumoModo: "unidades", consumoUnidades });
const automatico = (parcial: Record<string, unknown> = {}) => ({ modoAcao: "automatico", ...parcial });

describe("Preventive action control and consumption", () => {
  test("production above consumption raises the original stock", () => {
    const r = simular(fixture(), unidades(20));
    assert.equal(r.pontos[1]?.original, 130);
    assert.equal(r.pontos[2]?.original, 210);
  });

  test("production below consumption lowers the original stock", () => {
    const r = simular(fixture(), unidades(180));
    assert.equal(r.pontos[1]?.original, -30);
    assert.equal(r.pontos[2]?.original, -110);
  });

  test("production equal to consumption keeps the original stock constant", () => {
    const r = simular(fixture(), unidades(100));
    assert.deepEqual(r.pontos.map((p) => p.original), [50, 50, 50, 50, 50, 50, 50]);
  });

  test("valid variable daily production is preserved instead of replaced by its mean", () => {
    const r = simular(fixture({ e0: 0, h: 4 }), unidades(0), { producao: [100, 50, 25, 0] });
    assert.deepEqual(r.pontos.map((p) => p.original), [0, 100, 150, 175, 175]);
    assert.equal(r.projecaoMediaConstante, false);
  });

  test("manual consumption of 80 percent uses pre-intervention reference production", () => {
    const r = simular(fixture({ e0: 0 }), { consumoModo: "percentual", consumoPercentual: 80, ajustePercentual: 50 });
    assert.equal(r.pontos[1]?.consumoOriginal, 80);
    assert.equal(r.pontos[1]?.original, 20);
    assert.equal(r.pontos[1]?.ajustado, 70);
  });

  test("manual consumption of 100 percent balances reference production", () => {
    const r = simular(fixture({ e0: 0 }), { consumoModo: "percentual", consumoPercentual: 100 });
    assert.equal(r.pontos[1]?.original, 0);
  });

  test("manual consumption of 120 percent exceeds reference production", () => {
    const r = simular(fixture({ e0: 0 }), { consumoModo: "percentual", consumoPercentual: 120 });
    assert.equal(r.pontos[1]?.original, -20);
  });

  test("automatic action reduces production at the upper preventive line", () => {
    const r = simular(fixture({ e0: 70, p: 20 }), automatico(unidades(5)));
    assert.equal(r.pontos[1]?.original, 85);
    assert.equal(r.pontos[1]?.producaoAjustada, 9);
    assert.equal(r.pontos[1]?.ajustado, 74);
    assert.ok(Math.abs((r.pontos[1]?.ajustePercentualAplicado ?? 0) + 55) < 1e-8);
    assert.equal(r.pontos[1]?.acaoAtivada, true);
  });

  test("automatic action increases production at the lower preventive line", () => {
    const r = simular(fixture({ e0: 15, p: 20 }), automatico(unidades(20)));
    assert.equal(r.pontos[1]?.original, 15);
    assert.equal(r.pontos[1]?.producaoAjustada, 31);
    assert.equal(r.pontos[1]?.ajustado, 26);
    assert.ok(Math.abs((r.pontos[1]?.ajustePercentualAplicado ?? 0) - 55) < 1e-8);
  });

  test("touching either preventive line activates the controller", () => {
    const superior = simular(fixture({ e0: 60, p: 20 }), automatico(unidades(0)));
    assert.equal(superior.pontos[1]?.original, 80);
    assert.equal(superior.pontos[1]?.ajustado, 74);
    const inferior = simular(fixture({ e0: 20, p: 20 }), automatico(unidades(20)));
    assert.equal(inferior.pontos[1]?.original, 20);
    assert.equal(inferior.pontos[1]?.ajustado, 26);
  });

  test("a dynamic scenario changes from reduction to increase through stock balance only", () => {
    const r = simular(
      fixture({ e0: 70, p: 20, h: 8 }),
      automatico(),
      { producao: Array(8).fill(20), consumo: [5, 5, 5, 40, 40, 40, 40, 5] },
    );
    const reduz = r.pontos.find((p) => (p.ajustePercentualAplicado ?? 0) < 0);
    const aumenta = r.pontos.find((p) => p.dia > (reduz?.dia ?? 0) && (p.ajustePercentualAplicado ?? 0) > 0);
    assert.ok(reduz);
    assert.ok(aumenta);
    for (const p of r.pontos.slice(1)) {
      const anterior = r.pontos[p.dia - 1];
      assert.ok(anterior);
      assert.ok(Math.abs(p.ajustado - ((anterior.ajustado) + (p.producaoAjustada ?? 0) - (p.consumoAjustado ?? 0))) < 1e-8);
    }
  });

  test("zero maximum reduction cannot create an impossible production cut", () => {
    const r = simular(fixture({ e0: 75, p: 20 }), automatico({ ...unidades(5), reducaoMaxima: 0 }));
    assert.equal(r.pontos[1]?.producaoAjustada, 20);
    assert.equal(r.pontos[1]?.ajustado, 90);
    assert.ok(r.ajustado.diasAcima > 0 || r.pontos.some((p) => p.ajustado > r.preAlertaSuperior));
  });

  test("zero maximum increase cannot create impossible additional production", () => {
    const r = simular(fixture({ e0: 15, p: 20 }), automatico({ ...unidades(20), aumentoMaximo: 0 }));
    assert.equal(r.pontos[1]?.producaoAjustada, 20);
    assert.equal(r.pontos[1]?.ajustado, 15);
  });

  test("zero consumption never creates a fictitious stock decline", () => {
    const r = simular(fixture({ e0: 90, p: 20 }), automatico(unidades(0)));
    assert.equal(r.pontos[1]?.producaoAjustada, 0);
    assert.deepEqual(r.pontos.slice(1).map((p) => p.ajustado), Array(6).fill(90));
    assert.equal(r.reducaoInsuficienteSemConsumo, true);
  });

  test("a declared daily rate of change limits automatic intervention", () => {
    const r = simular(fixture({ e0: 15, p: 20 }), automatico({ ...unidades(20), taxaMaximaDiaria: 2 }));
    assert.equal(r.pontos[1]?.producaoAjustada, 22);
    assert.equal(r.pontos[1]?.ajustado, 17);
  });

  test("both curves use the same variable automatic consumption", () => {
    const r = simular(fixture({ h: 3 }), automatico(), { producao: [100, 100, 100], consumo: [20, 40, 60] });
    assert.deepEqual(r.pontos.slice(1).map((p) => p.consumoOriginal), [20, 40, 60]);
    assert.deepEqual(r.pontos.map((p) => p.consumoOriginal), r.pontos.map((p) => p.consumoAjustado));
    assert.equal(r.consumoIndisponivel, false);
  });

  test("manual zero adjustment remains identical with variable production and manual consumption", () => {
    const r = simular(fixture({ e0: 0.1, h: 4 }), unidades(20), { producao: [100.3, 50.2, 25.1, 0] });
    assert.deepEqual(r.pontos.map((p) => p.original), r.pontos.map((p) => p.ajustado));
  });

  test("consumption and intervention ranges are validated", () => {
    assert.notEqual(validarAcao(config({ consumoModo: "percentual", consumoPercentual: 201 }), 30), null);
    assert.notEqual(validarAcao(config({ consumoModo: "unidades", consumoUnidades: -1 }), 30), null);
    assert.notEqual(validarAcao(config(automatico({ reducaoMaxima: 101 })), 30), null);
    assert.notEqual(validarAcao(config(automatico({ aumentoMaximo: -1 })), 30), null);
  });

  test("missing production or automatic consumption is reported rather than invented", () => {
    const semProducao = simularAcao(fixture({ h: 2 }), config(), { producao: [100] });
    assert.equal(semProducao, null);
    const r = simular(fixture({ h: 2 }), automatico(), { producao: [100, 100], consumo: [null, null] });
    assert.equal(r.consumoIndisponivel, true);
    assert.equal(r.pontos[1]?.consumoOriginal, 0);
  });
});
