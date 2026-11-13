import type { AutoSnapshot, EstadoEstoque } from "./autoSimulation";

export type ActionConfig = {
  ajustePercentual: number;
  diaInicio: number;
  validarOperacional: boolean;
  producaoMinima: number;
  producaoMaxima: number;
  modoAcao?: "manual" | "automatico";
  consumoModo?: "automatico" | "percentual" | "unidades";
  consumoPercentual?: number;
  consumoUnidades?: number;
  reducaoMaxima?: number;
  aumentoMaximo?: number;
  taxaMaximaDiaria?: number | null;
};

export type ActionSeries = {
  producao: number[];
  consumo?: (number | null)[];
};

export type ActionPoint = {
  dia: number;
  original: number;
  ajustado: number;
  diferenca: number;
  producaoOriginal: number | null;
  producaoAjustada: number | null;
  consumoOriginal: number | null;
  consumoAjustado: number | null;
  ajustePercentualAplicado: number | null;
  acaoAtivada: boolean;
  ativacaoAjustada: number | null;
  estadoOriginal: EstadoEstoque;
  estadoAjustado: EstadoEstoque;
  violacaoOriginal: number | null;
  violacaoAjustada: number | null;
};

export type RiskMetrics = {
  primeiroDiaInferior: number | null;
  primeiroDiaSuperior: number | null;
  diasAbaixo: number;
  diasAcima: number;
  maiorDeficit: number;
  maiorExcesso: number;
  saldoMinimo: number;
  saldoMaximo: number;
  diasDentro: number;
  diasPreventivos: number;
};

export type RiskClassification =
  | "RISCO_JA_EXISTENTE"
  | "RISCO_TRANSFERIDO"
  | "RISCO_CRIADO"
  | "RISCO_EVITADO"
  | "RISCO_REDUZIDO"
  | "RISCO_AGRAVADO"
  | "RISCO_MISTO"
  | "RISCO_MANTIDO"
  | "SEM_RISCO_IDENTIFICADO";

export type OperationalViolation = {
  dia: number;
  valor: number;
  limite: "MINIMO" | "MAXIMO";
  valorLimite: number;
};

export type ActionSnapshot = {
  tipo: "acao";
  geradoEm: string;
  workCenter: string;
  horizonte: number;
  ajustePercentual: number;
  diaInicio: number;
  modoAcao: "manual" | "automatico";
  estoqueMinimo: number;
  estoqueMaximo: number;
  preAlertaInferior: number;
  preAlertaSuperior: number;
  producaoOriginalRef: number;
  producaoAjustadaRef: number;
  consumoIndisponivel: boolean | null;
  projecaoMediaConstante: boolean;
  reducaoInsuficienteSemConsumo: boolean;
  pontos: ActionPoint[];
  original: RiskMetrics;
  ajustado: RiskMetrics;
  classificacao: RiskClassification;
  classificacaoIntervencao: Exclude<RiskClassification, "RISCO_JA_EXISTENTE">;
  riscoInicial: boolean;
  primeiroDiaRecuperacao: number | null;
  violacoesAposRecuperacao: number | null;
  transferenciaRisco: boolean;
  seguroNoHorizonte: boolean;
  operacional: {
    status: "VIAVEL" | "INVIAVEL" | "NAO_VERIFICADA";
    minimo: number | null;
    maximo: number | null;
    violacoes: OperationalViolation[];
  };
};

export const ROTULO_CLASSIFICACAO: Record<RiskClassification, string> = {
  RISCO_JA_EXISTENTE: "Risco já existente",
  RISCO_TRANSFERIDO: "Risco transferido",
  RISCO_CRIADO: "Risco criado",
  RISCO_EVITADO: "Risco evitado",
  RISCO_REDUZIDO: "Risco reduzido",
  RISCO_AGRAVADO: "Risco agravado",
  RISCO_MISTO: "Risco misto",
  RISCO_MANTIDO: "Risco mantido",
  SEM_RISCO_IDENTIFICADO: "Sem risco identificado",
};

export function validarAcao(c: ActionConfig, horizonte: number): string | null {
  if (!Number.isFinite(c.ajustePercentual) || c.ajustePercentual < -100 || c.ajustePercentual > 100) {
    return "O ajuste deve estar entre -100% e +100%.";
  }
  if (!Number.isInteger(c.diaInicio) || c.diaInicio < 0 || c.diaInicio > horizonte) {
    return `O início deve ser um dia inteiro entre 0 e ${horizonte}.`;
  }
  if (c.validarOperacional) {
    if (!Number.isFinite(c.producaoMinima) || !Number.isFinite(c.producaoMaxima) || c.producaoMinima < 0 || c.producaoMaxima < 0) {
      return "Informe limites operacionais válidos e não negativos.";
    }
    if (c.producaoMinima > c.producaoMaxima) {
      return "A produção mínima operacional deve ser menor ou igual à máxima.";
    }
  }
  if (c.consumoModo === "percentual" && (!Number.isFinite(c.consumoPercentual) || (c.consumoPercentual ?? -1) < 0 || (c.consumoPercentual ?? 201) > 200)) {
    return "O consumo percentual deve estar entre 0% e 200%.";
  }
  if (c.consumoModo === "unidades" && (!Number.isFinite(c.consumoUnidades) || (c.consumoUnidades ?? -1) < 0)) {
    return "Informe um consumo diário válido e não negativo.";
  }
  if (c.modoAcao === "automatico") {
    const reducao = c.reducaoMaxima ?? 100;
    const aumento = c.aumentoMaximo ?? 100;
    if (!Number.isFinite(reducao) || reducao < 0 || reducao > 100) return "A redução máxima deve estar entre 0% e 100%.";
    if (!Number.isFinite(aumento) || aumento < 0 || aumento > 100) return "O aumento máximo deve estar entre 0% e 100%.";
    if (c.taxaMaximaDiaria !== undefined && c.taxaMaximaDiaria !== null && (!Number.isFinite(c.taxaMaximaDiaria) || c.taxaMaximaDiaria < 0)) {
      return "A taxa máxima de mudança diária deve ser não negativa.";
    }
  }
  return null;
}

/** Repete deterministicamente o perfil dos últimos sete dias válidos, sem inventar variação. */
export function projetarProducaoDiaria(
  serie: { producao: number }[],
  horizonte: number,
): { valores: number[]; constante: boolean } | null {
  const validos = serie.filter((p) => Number.isFinite(p.producao) && p.producao > 0).slice(-7).map((p) => p.producao);
  if (!validos.length || !Number.isInteger(horizonte) || horizonte < 1) return null;
  const primeiro = validos[0];
  return {
    valores: Array.from({ length: horizonte }, (_, i) => validos[i % validos.length] ?? primeiro ?? 0),
    constante: validos.length < 2 || validos.every((v) => v === primeiro),
  };
}

function estado(estoque: number, s: AutoSnapshot): EstadoEstoque {
  if (estoque < s.estoqueMinimo) return "RISCO_INFERIOR";
  if (estoque > s.estoqueMaximo) return "RISCO_SUPERIOR";
  if (estoque <= s.preAlertaInferior) return "PROXIMO_MINIMO";
  if (estoque >= s.preAlertaSuperior) return "PROXIMO_MAXIMO";
  return "ADEQUADO";
}

function metricas(pontos: ActionPoint[], campo: "original" | "ajustado", s: AutoSnapshot): RiskMetrics {
  let primeiroDiaInferior: number | null = null;
  let primeiroDiaSuperior: number | null = null;
  let diasAbaixo = 0;
  let diasAcima = 0;
  let maiorDeficit = 0;
  let maiorExcesso = 0;
  let saldoMinimo = Number.POSITIVE_INFINITY;
  let saldoMaximo = Number.NEGATIVE_INFINITY;
  let diasDentro = 0;
  let diasPreventivos = 0;

  for (const p of pontos) {
    const valor = p[campo];
    const abaixo = valor < s.estoqueMinimo;
    const acima = valor > s.estoqueMaximo;
    if (abaixo) {
      diasAbaixo++;
      if (primeiroDiaInferior === null) primeiroDiaInferior = p.dia;
      maiorDeficit = Math.max(maiorDeficit, s.estoqueMinimo - valor);
    } else if (acima) {
      diasAcima++;
      if (primeiroDiaSuperior === null) primeiroDiaSuperior = p.dia;
      maiorExcesso = Math.max(maiorExcesso, valor - s.estoqueMaximo);
    } else {
      diasDentro++;
      if (valor <= s.preAlertaInferior || valor >= s.preAlertaSuperior) diasPreventivos++;
    }
    saldoMinimo = Math.min(saldoMinimo, valor);
    saldoMaximo = Math.max(saldoMaximo, valor);
  }

  return { primeiroDiaInferior, primeiroDiaSuperior, diasAbaixo, diasAcima, maiorDeficit, maiorExcesso, saldoMinimo, saldoMaximo, diasDentro, diasPreventivos };
}

function temViolacao(m: RiskMetrics): boolean {
  return m.diasAbaixo > 0 || m.diasAcima > 0;
}

function classificarIntervencao(o: RiskMetrics, a: RiskMetrics): Exclude<RiskClassification, "RISCO_JA_EXISTENTE"> {
  const originalSemRisco = !temViolacao(o);
  const ajustadoSemRisco = !temViolacao(a);
  if (originalSemRisco && ajustadoSemRisco) return "SEM_RISCO_IDENTIFICADO";
  if (originalSemRisco) return "RISCO_CRIADO";
  if (ajustadoSemRisco) return "RISCO_EVITADO";

  const transferiuFaltaParaExcesso = o.diasAbaixo > 0 && o.diasAcima === 0 && a.diasAbaixo === 0 && a.diasAcima > 0;
  const transferiuExcessoParaFalta = o.diasAcima > 0 && o.diasAbaixo === 0 && a.diasAcima === 0 && a.diasAbaixo > 0;
  if (transferiuFaltaParaExcesso || transferiuExcessoParaFalta) return "RISCO_TRANSFERIDO";

  const indicadores = ["diasAbaixo", "diasAcima", "maiorDeficit", "maiorExcesso"] as const;
  const melhorias = indicadores.filter((k) => a[k] < o[k]).length;
  const pioras = indicadores.filter((k) => a[k] > o[k]).length;
  if (melhorias > 0 && pioras === 0) return "RISCO_REDUZIDO";
  if (pioras > 0 && melhorias === 0) return "RISCO_AGRAVADO";
  if (pioras > 0 && melhorias > 0) return "RISCO_MISTO";
  return "RISCO_MANTIDO";
}

const limitar = (valor: number, minimo: number, maximo: number) => Math.min(maximo, Math.max(minimo, valor));

function serieValida(valores: number[] | undefined, horizonte: number, permiteZero = true): valores is number[] {
  return Boolean(valores && valores.length >= horizonte && valores.slice(0, horizonte).every((v) => Number.isFinite(v) && (permiteZero ? v >= 0 : v > 0)));
}

/**
 * Projeta o saldo livre e a intervenção exclusivamente pelo balanço P − C.
 * O modo automático recalcula P a cada intervalo, com histerese e limites de cenário;
 * esses limites não são apresentados como capacidade industrial comprovada.
 */
export function simularAcao(base: AutoSnapshot, c: ActionConfig, fonte?: ActionSeries): ActionSnapshot | null {
  if (validarAcao(c, base.horizonte) || base.trajetoria.length !== base.horizonte + 1) return null;
  if (fonte?.producao && !serieValida(fonte.producao, base.horizonte)) return null;
  if (fonte?.consumo && fonte.consumo.length < base.horizonte) return null;

  const consumoBase = base.consumoAtivo && base.consumoRef !== null ? base.consumoRef : 0;
  const producoes: number[] = [];
  for (let t = 1; t <= base.horizonte; t++) {
    const atual = base.trajetoria[t]?.estoque;
    const anterior = base.trajetoria[t - 1]?.estoque;
    if (atual === undefined || anterior === undefined) return null;
    producoes.push(fonte?.producao?.[t - 1] ?? atual - anterior + consumoBase);
  }

  const modoConsumo = c.consumoModo ?? "automatico";
  const consumos: (number | null)[] = [];
  for (let t = 0; t < base.horizonte; t++) {
    if (modoConsumo === "percentual") consumos.push(base.producaoRef * (c.consumoPercentual ?? 100) / 100);
    else if (modoConsumo === "unidades") consumos.push(c.consumoUnidades ?? 0);
    else if (fonte?.consumo) {
      const valor = fonte.consumo[t];
      consumos.push(typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor : null);
    } else consumos.push(base.consumoAtivo && base.consumoRef !== null ? base.consumoRef : null);
  }
  const consumoIndisponivel = modoConsumo === "automatico" ? consumos.some((v) => v === null) : null;

  const modoAcao = c.modoAcao ?? "manual";
  const fator = 1 + c.ajustePercentual / 100;
  const pontos: ActionPoint[] = [];
  let original = base.estoqueAtual;
  let ajustado = base.estoqueAtual;
  const estadoInicial = estado(original, base);
  pontos.push({
    dia: 0,
    original,
    ajustado,
    diferenca: 0,
    producaoOriginal: null,
    producaoAjustada: null,
    consumoOriginal: null,
    consumoAjustado: null,
    ajustePercentualAplicado: null,
    acaoAtivada: false,
    ativacaoAjustada: null,
    estadoOriginal: estadoInicial,
    estadoAjustado: estadoInicial,
    violacaoOriginal: estadoInicial === "RISCO_INFERIOR" || estadoInicial === "RISCO_SUPERIOR" ? original : null,
    violacaoAjustada: estadoInicial === "RISCO_INFERIOR" || estadoInicial === "RISCO_SUPERIOR" ? ajustado : null,
  });

  let controle: "NEUTRO" | "REDUZIR" | "AUMENTAR" = "NEUTRO";
  const margem = Math.max(0, (base.preAlertaSuperior - base.preAlertaInferior) * 0.1);
  const alvoSuperior = base.preAlertaSuperior - margem;
  const alvoInferior = base.preAlertaInferior + margem;

  for (let t = 1; t <= base.horizonte; t++) {
    const producao = producoes[t - 1];
    if (producao === undefined) return null;
    const consumo = consumos[t - 1] ?? 0;
    const anteriorOriginal = original;
    const anteriorAjustado = ajustado;
    original = anteriorOriginal + producao - consumo;

    let producaoAjustada = producao;
    if (t > c.diaInicio && modoAcao === "manual") {
      producaoAjustada = Math.max(0, producao * fator);
    } else if (t > c.diaInicio) {
      const semAcao = anteriorAjustado + producao - consumo;
      if (semAcao >= base.preAlertaSuperior || anteriorAjustado > base.preAlertaSuperior) controle = "REDUZIR";
      else if (semAcao <= base.preAlertaInferior || anteriorAjustado < base.preAlertaInferior) controle = "AUMENTAR";
      else if (controle === "REDUZIR" && anteriorAjustado <= alvoSuperior && semAcao < base.preAlertaSuperior) controle = "NEUTRO";
      else if (controle === "AUMENTAR" && anteriorAjustado >= alvoInferior && semAcao > base.preAlertaInferior) controle = "NEUTRO";

      const producaoAnterior = t === 1 ? producao : (pontos[t - 1]?.producaoAjustada ?? producao);
      let desejada = producao;
      if (controle === "REDUZIR") desejada = consumo + alvoSuperior - anteriorAjustado;
      else if (controle === "AUMENTAR") desejada = consumo + alvoInferior - anteriorAjustado;
      else {
        desejada = producaoAnterior + (producao - producaoAnterior) / 2;
        desejada = Math.min(desejada, consumo + base.preAlertaSuperior - anteriorAjustado);
        desejada = Math.max(desejada, consumo + base.preAlertaInferior - anteriorAjustado);
      }

      let minimo = Math.max(0, producao * (1 - (c.reducaoMaxima ?? 100) / 100));
      let maximo = Math.max(minimo, producao * (1 + (c.aumentoMaximo ?? 100) / 100));
      if (c.validarOperacional) {
        minimo = Math.max(minimo, c.producaoMinima);
        maximo = Math.min(maximo, c.producaoMaxima);
      }
      if (c.taxaMaximaDiaria !== undefined && c.taxaMaximaDiaria !== null) {
        minimo = Math.max(minimo, producaoAnterior - c.taxaMaximaDiaria);
        maximo = Math.min(maximo, producaoAnterior + c.taxaMaximaDiaria);
      }
      producaoAjustada = maximo < minimo ? limitar(producao, Math.max(0, producao * (1 - (c.reducaoMaxima ?? 100) / 100)), Math.max(0, producao * (1 + (c.aumentoMaximo ?? 100) / 100))) : limitar(desejada, minimo, maximo);
    }

    ajustado = anteriorAjustado + producaoAjustada - consumo;
    const estadoOriginal = estado(original, base);
    const estadoAjustado = estado(ajustado, base);
    const ajusteAplicado = producao > 0 ? (producaoAjustada / producao - 1) * 100 : null;
    const acaoAtivada = t > c.diaInicio && Math.abs(producaoAjustada - producao) > 1e-9;
    pontos.push({
      dia: t,
      original,
      ajustado,
      diferenca: ajustado - original,
      producaoOriginal: producao,
      producaoAjustada,
      consumoOriginal: consumo,
      consumoAjustado: consumo,
      ajustePercentualAplicado: ajusteAplicado,
      acaoAtivada,
      ativacaoAjustada: acaoAtivada ? ajustado : null,
      estadoOriginal,
      estadoAjustado,
      violacaoOriginal: estadoOriginal === "RISCO_INFERIOR" || estadoOriginal === "RISCO_SUPERIOR" ? original : null,
      violacaoAjustada: estadoAjustado === "RISCO_INFERIOR" || estadoAjustado === "RISCO_SUPERIOR" ? ajustado : null,
    });
  }

  const originalMetricas = metricas(pontos, "original", base);
  const ajustadoMetricas = metricas(pontos, "ajustado", base);
  const riscoInicial = pontos[0]?.estadoOriginal === "RISCO_INFERIOR" || pontos[0]?.estadoOriginal === "RISCO_SUPERIOR";
  const classificacaoIntervencao = classificarIntervencao(originalMetricas, ajustadoMetricas);
  const transferenciaRisco = classificacaoIntervencao === "RISCO_TRANSFERIDO";
  const primeiroDiaRecuperacao = riscoInicial
    ? (pontos.find((p) => p.dia > 0 && p.estadoAjustado !== "RISCO_INFERIOR" && p.estadoAjustado !== "RISCO_SUPERIOR")?.dia ?? null)
    : null;
  const violacoesAposRecuperacao = primeiroDiaRecuperacao === null
    ? null
    : pontos.filter((p) => p.dia >= primeiroDiaRecuperacao && (p.estadoAjustado === "RISCO_INFERIOR" || p.estadoAjustado === "RISCO_SUPERIOR")).length;

  const violacoes: OperationalViolation[] = [];
  if (c.validarOperacional) {
    for (const p of pontos) {
      if (p.dia <= c.diaInicio || p.producaoAjustada === null) continue;
      if (p.producaoAjustada < c.producaoMinima) violacoes.push({ dia: p.dia, valor: p.producaoAjustada, limite: "MINIMO", valorLimite: c.producaoMinima });
      else if (p.producaoAjustada > c.producaoMaxima) violacoes.push({ dia: p.dia, valor: p.producaoAjustada, limite: "MAXIMO", valorLimite: c.producaoMaxima });
    }
  }

  return {
    tipo: "acao",
    geradoEm: new Date().toISOString(),
    workCenter: base.workCenter,
    horizonte: base.horizonte,
    ajustePercentual: c.ajustePercentual,
    diaInicio: c.diaInicio,
    modoAcao,
    estoqueMinimo: base.estoqueMinimo,
    estoqueMaximo: base.estoqueMaximo,
    preAlertaInferior: base.preAlertaInferior,
    preAlertaSuperior: base.preAlertaSuperior,
    producaoOriginalRef: base.producaoRef,
    producaoAjustadaRef: Math.max(0, base.producaoRef * fator),
    consumoIndisponivel,
    projecaoMediaConstante: !fonte?.producao || fonte.producao.slice(0, base.horizonte).every((p) => p === fonte.producao?.[0]),
    reducaoInsuficienteSemConsumo: pontos.some((p) => p.dia > 0 && p.ajustado > base.preAlertaSuperior && p.producaoAjustada === 0 && p.consumoAjustado === 0),
    pontos,
    original: originalMetricas,
    ajustado: ajustadoMetricas,
    classificacao: riscoInicial ? "RISCO_JA_EXISTENTE" : classificacaoIntervencao,
    classificacaoIntervencao,
    riscoInicial,
    primeiroDiaRecuperacao,
    violacoesAposRecuperacao,
    transferenciaRisco,
    seguroNoHorizonte: !temViolacao(ajustadoMetricas),
    operacional: {
      status: !c.validarOperacional ? "NAO_VERIFICADA" : violacoes.length ? "INVIAVEL" : "VIAVEL",
      minimo: c.validarOperacional ? c.producaoMinima : null,
      maximo: c.validarOperacional ? c.producaoMaxima : null,
      violacoes,
    },
  };
}
