import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import type { AutoSnapshot } from "./autoSimulation";
import { simularAcao, validarAcao, type ActionConfig } from "./actionSimulation";

const expect = (actual: unknown) => ({
  toBe: (expected: unknown) => assert.equal(actual, expected),
  toBeCloseTo: (expected: number) => assert.ok(typeof actual === "number" && Math.abs(actual - expected) < 0.0001),
});

function fixture({
  e0 = 50,
  p = 10,
  consumo = 0,
  consumoAtivo = true,
  h = 4,
  min = 0,
  max = 100,
}: {
  e0?: number;
  p?: number;
  consumo?: number | null;
  consumoAtivo?: boolean;
  h?: number;
  min?: number;
  max?: number;
} = {}): AutoSnapshot {
  const consumoConhecido = consumoAtivo && consumo !== null ? consumo : 0;
  const trajetoria = [{ dia: 0, estoque: e0 }];
  for (let dia = 1; dia <= h; dia++) {
    trajetoria.push({ dia, estoque: e0 + dia * (p - consumoConhecido) });
  }
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
    consumoAtivo,
    consumoRef: consumo,
    janelaConsumo: consumoAtivo ? 30 : null,
    saldoLiquido: p - consumoConhecido,
    trajetoria,
    estadoEstoque: "ADEQUADO",
    estadoProducao: "ADEQUADA",
    diaEvento: null,
    evento: "",
    recomendacao: "",
  };
}

function config(parcial: Partial<ActionConfig> = {}): ActionConfig {
  return {
    ajustePercentual: 0,
    diaInicio: 0,
    validarOperacional: false,
    producaoMinima: 0,
    producaoMaxima: 0,
    ...parcial,
  };
}

function simular(base: AutoSnapshot, parcial: Partial<ActionConfig> = {}) {
  const resultado = simularAcao(base, config(parcial));
  assert.ok(resultado);
  return resultado;
}

describe("Action simulator trajectory mathematics", () => {
  test("minus twenty percent reduces each future production interval", () => {
    const r = simular(fixture({ p: 100, h: 7 }), { ajustePercentual: -20 });
    expect(r.pontos[1]?.original).toBe(150);
    expect(r.pontos[1]?.ajustado).toBe(130);
    expect(r.pontos[7]?.ajustado).toBe(610);
  });

  test("plus twenty percent increases each future production interval", () => {
    const r = simular(fixture({ p: 100, h: 7 }), { ajustePercentual: 20 });
    expect(r.pontos[1]?.ajustado).toBe(170);
    expect(r.pontos[7]?.ajustado).toBe(890);
  });

  test("day five preserves coincidence through day five and changes day six", () => {
    const r = simular(fixture({ p: 100, h: 7 }), { ajustePercentual: -20, diaInicio: 5 });
    assert.deepEqual(r.pontos.slice(0, 6).map((p) => p.original), r.pontos.slice(0, 6).map((p) => p.ajustado));
    expect(r.pontos[6]?.diferenca).toBe(-20);
    expect(r.pontos[7]?.diferenca).toBe(-40);
  });

  test("fractional balances remain exactly identical at zero adjustment", () => {
    const r = simular(fixture({ e0: 0.1, p: 0.2, consumo: 0.1, h: 30 }));
    assert.deepEqual(r.pontos.map((p) => p.original), r.pontos.map((p) => p.ajustado));
  });
  test("zero adjustment produces identical curves", () => {
    const r = simular(fixture(), { ajustePercentual: 0 });
    assert.deepEqual(r.pontos.map((p) => p.original), r.pontos.map((p) => p.ajustado));
    expect(r.classificacao).toBe("SEM_RISCO_IDENTIFICADO");
  });

  test("positive and negative adjustments are monotonic relative to original", () => {
    const positivo = simular(fixture(), { ajustePercentual: 50 });
    const negativo = simular(fixture(), { ajustePercentual: -50 });
    for (const p of positivo.pontos) assert.ok(p.ajustado >= p.original);
    for (const p of negativo.pontos) assert.ok(p.ajustado <= p.original);
  });

  test("day zero affects the first interval and future start preserves earlier points", () => {
    const agora = simular(fixture({ p: 20 }), { ajustePercentual: 50, diaInicio: 0 });
    const futuro = simular(fixture({ p: 20 }), { ajustePercentual: 50, diaInicio: 2 });
    expect(agora.pontos[1]?.producaoAjustada).toBe(30);
    expect(agora.pontos[1]?.diferenca).toBe(10);
    assert.deepEqual(futuro.pontos.slice(0, 3).map((p) => p.original), futuro.pontos.slice(0, 3).map((p) => p.ajustado));
    expect(futuro.pontos[3]?.producaoAjustada).toBe(30);
  });

  test("reduction avoids excess without creating shortage", () => {
    const r = simular(fixture({ e0: 80, p: 10, h: 3, max: 100 }), { ajustePercentual: -50 });
    expect(r.classificacao).toBe("RISCO_EVITADO");
    expect(r.ajustado.diasAcima).toBe(0);
    expect(r.ajustado.diasAbaixo).toBe(0);
  });

  test("reduction transfers excess risk to shortage", () => {
    const r = simular(fixture({ e0: 90, p: 100, consumo: 80, h: 3, max: 100 }), { ajustePercentual: -100 });
    expect(r.classificacao).toBe("RISCO_TRANSFERIDO");
    expect(r.transferenciaRisco).toBe(true);
    expect(r.ajustado.diasAcima).toBe(0);
    assert.ok(r.ajustado.diasAbaixo > 0);
  });

  test("increase transfers shortage risk to excess", () => {
    const r = simular(fixture({ e0: 50, p: 80, consumo: 100, h: 3, max: 200 }), { ajustePercentual: 100 });
    expect(r.classificacao).toBe("RISCO_TRANSFERIDO");
    expect(r.ajustado.diasAbaixo).toBe(0);
    assert.ok(r.ajustado.diasAcima > 0);
  });

  test("safe final balance never hides an intermediate violation", () => {
    const r = simular(fixture({ e0: 20, p: 100, consumo: 50, h: 4, max: 100 }), { ajustePercentual: -100, diaInicio: 2 });
    expect(r.pontos[4]?.ajustado).toBe(20);
    expect(r.ajustado.primeiroDiaSuperior).toBe(2);
    expect(r.seguroNoHorizonte).toBe(false);
  });

  test("initial violation remains an independent warning and recovery is reported", () => {
    const r = simular(fixture({ e0: 120, p: 0, consumo: 20, h: 3, max: 100 }));
    expect(r.classificacao).toBe("RISCO_JA_EXISTENTE");
    expect(r.riscoInicial).toBe(true);
    expect(r.primeiroDiaRecuperacao).toBe(1);
    expect(r.violacoesAposRecuperacao).toBe(0);
    expect(r.seguroNoHorizonte).toBe(false);
  });

  test("inclusive minimum and maximum are not violations", () => {
    for (const e0 of [0, 100]) {
      const r = simular(fixture({ e0, p: 0, h: 2 }));
      expect(r.seguroNoHorizonte).toBe(true);
      expect(r.ajustado.diasDentro).toBe(3);
      expect(r.ajustado.diasPreventivos).toBe(3);
    }
  });

  test("risk created, reduced, aggravated, mixed and maintained follow all-day metrics", () => {
    expect(simular(fixture({ p: 10, h: 5 }), { ajustePercentual: 100 }).classificacao).toBe("RISCO_CRIADO");
    expect(simular(fixture({ e0: 90, p: 20, h: 3 }), { ajustePercentual: -50 }).classificacao).toBe("RISCO_REDUZIDO");
    expect(simular(fixture({ e0: 90, p: 20, h: 3 }), { ajustePercentual: 50 }).classificacao).toBe("RISCO_AGRAVADO");
    expect(simular(fixture({ e0: 20, p: 100, consumo: 50, h: 5 }), { ajustePercentual: -100, diaInicio: 2 }).classificacao).toBe("RISCO_MISTO");
    expect(simular(fixture({ e0: 90, p: 20, h: 3 })).classificacao).toBe("RISCO_MANTIDO");
  });

  test("production below operational maximum is viable and excess is reported without clamping", () => {
    const base = fixture({ p: 100 });
    const viavel = simular(base, { ajustePercentual: 10, validarOperacional: true, producaoMinima: 50, producaoMaxima: 120 });
    expect(viavel.operacional.status).toBe("VIAVEL");
    const inviavel = simular(base, { ajustePercentual: 50, validarOperacional: true, producaoMinima: 50, producaoMaxima: 120 });
    expect(inviavel.operacional.status).toBe("INVIAVEL");
    expect(inviavel.operacional.violacoes[0]?.dia).toBe(1);
    expect(inviavel.operacional.violacoes[0]?.valor).toBe(150);
    expect(inviavel.pontos[1]?.producaoAjustada).toBe(150);
  });

  test("disabled operational validation remains explicitly unverified", () => {
    const r = simular(fixture({ p: 100 }), { ajustePercentual: 50, validarOperacional: false });
    expect(r.operacional.status).toBe("NAO_VERIFICADA");
    expect(r.operacional.minimo).toBe(null);
  });

  test("invalid operational ranges are rejected", () => {
    expect(validarAcao(config({ validarOperacional: true, producaoMinima: 20, producaoMaxima: 10 }), 30) !== null).toBe(true);
    expect(validarAcao(config({ validarOperacional: true, producaoMinima: -1, producaoMaxima: 10 }), 30) !== null).toBe(true);
    expect(simularAcao(fixture(), config({ diaInicio: 31 }))).toBe(null);
  });

  test("missing withdrawal history is not invented", () => {
    const r = simular(fixture({ p: 25, consumo: null, consumoAtivo: true }), { ajustePercentual: 20 });
    expect(r.consumoIndisponivel).toBe(true);
    expect(r.pontos[1]?.original).toBe(75);
    expect(r.pontos[1]?.ajustado).toBe(80);
  });

  test("minus one hundred percent never creates negative production", () => {
    const r = simular(fixture({ p: 40, consumo: 10 }), { ajustePercentual: -100 });
    assert.ok(r.pontos.slice(1).every((p) => p.producaoAjustada === 0));
    expect(r.pontos[1]?.ajustado).toBe(40);
  });
});
