import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProductionRecord } from "@/lib/mes.functions";
import { formatarNumero, prepararSerie, TODOS_WORK_CENTERS } from "@/lib/twin-math";
import { calcularProjecaoAutomatica, estoqueMinimo, ROTULO_PRODUCAO, validarConfig, type AutoConfig, type AutoSnapshot } from "@/lib/autoSimulation";
import { projetarProducaoDiaria, simularAcao, validarAcao, type ActionConfig, type ActionPoint, type ActionSnapshot, type RiskMetrics } from "@/lib/actionSimulation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const num = (v: string, min = 0) => Math.min(9_999_999_999, Math.max(min, Number(v) || 0));

export function ActionSimulator({ records, workCenters, workCenterAtual, automaticParameters }: {
  records: ProductionRecord[];
  workCenters: string[];
  workCenterAtual: string;
  automaticParameters?: { config: AutoConfig; inventoryKnown: boolean } | null;
}) {
  const [auto, setAuto] = useState(true);
  const [acaoAutomatica, setAcaoAutomatica] = useState(true);
  const [editados, setEditados] = useState<Partial<AutoConfig>>({});
  const [estoqueInformado, setEstoqueInformado] = useState<string | null>(null);
  const [ajuste, setAjuste] = useState({ percentual: 0, diaInicio: 0 });
  const [consumo, setConsumo] = useState<{ modo: "automatico" | "percentual"; percentual: number; unidades: string }>({ modo: "automatico", percentual: 100, unidades: "" });
  const [limites, setLimites] = useState({ reducao: 100, aumento: 100, taxa: "" });
  const [resultado, setResultado] = useState<{ base: AutoSnapshot; acao: ActionSnapshot } | null>(null);
  const [avancado, setAvancado] = useState(false);

  const cfg = useMemo<AutoConfig>(() => ({
    workCenter: workCenterAtual, horizonte: 30, estoqueAtual: NaN, estoqueMaximo: 100000,
    minimoModo: "auto", estoqueMinimoManual: 20000, consumoAtivo: false, janelaConsumo: 30,
    pctMinimo: 20, pctPreAlerta: 20, pctProducaoMin: 20, pctProducaoMax: 100,
    ...automaticParameters?.config, ...editados,
  }), [workCenterAtual, automaticParameters, editados]);
  const estoqueHerdado = automaticParameters?.inventoryKnown && automaticParameters.config.workCenter === cfg.workCenter;
  const estoqueTexto = estoqueInformado ?? (estoqueHerdado ? String(automaticParameters?.config.estoqueAtual) : "");
  const config = useMemo(() => ({ ...cfg, estoqueAtual: estoqueTexto.trim() === "" ? NaN : Number(estoqueTexto) }), [cfg, estoqueTexto]);
  const serie = useMemo(() => prepararSerie(records, cfg.workCenter, 365), [records, cfg.workCenter]);
  const fonte = useMemo(() => {
    const projecao = projetarProducaoDiaria(serie, cfg.horizonte);
    return projecao ? { producao: projecao.valores } : undefined;
  }, [serie, cfg.horizonte]);
  const configAcao = useMemo<ActionConfig>(() => ({
    validarOperacional: false,
    producaoMinima: 0,
    producaoMaxima: 0,
    modoAcao: acaoAutomatica ? "automatico" : "manual",
    ajustePercentual: ajuste.percentual,
    diaInicio: Math.min(ajuste.diaInicio, cfg.horizonte),
    consumoModo: consumo.unidades.trim() !== "" ? "unidades" : consumo.modo,
    consumoPercentual: consumo.percentual,
    consumoUnidades: consumo.unidades.trim() === "" ? 0 : Number(consumo.unidades),
    reducaoMaxima: limites.reducao,
    aumentoMaximo: limites.aumento,
    taxaMaximaDiaria: limites.taxa.trim() === "" ? null : Number(limites.taxa),
  }), [acaoAutomatica, ajuste, cfg.horizonte, consumo, limites]);
  const erro = !Number.isFinite(config.estoqueAtual) ? "Informe o estoque disponível hoje." : validarConfig(config) ?? validarAcao(configAcao, cfg.horizonte);
  const calcular = () => {
    if (erro || !fonte) return null;
    const base = calcularProjecaoAutomatica(serie, config);
    const acao = base ? simularAcao(base, configAcao, fonte) : null;
    return base && acao ? { base, acao } : null;
  };
  const novaProjecao = useMemo(calcular, [auto, erro, serie, config, configAcao, fonte]);
  useEffect(() => { if (auto) setResultado(novaProjecao); }, [auto, novaProjecao]);
  const set = <K extends keyof AutoConfig>(k: K, v: AutoConfig[K]) => setEditados((c) => ({ ...c, [k]: v }));
  function projetar() { if (auto || !erro) setResultado(calcular()); }

  const producaoRef = useMemo(() => {
    const validos = serie.filter((p) => Number.isFinite(p.producao) && p.producao > 0).slice(-7);
    return validos.length ? validos.reduce((s, p) => s + p.producao, 0) / validos.length : null;
  }, [serie]);

  return (
    <section className="mx-auto mt-4 max-w-7xl" aria-label="Simulador de ações">
      <div className="panel space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-normal">Simulador de ações Gêmeo Digital</h2>
            <p className="mt-1 text-xs text-muted-foreground">Intervenções apenas simuladas; nenhum comando é enviado à produção.</p>
          </div>
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:gap-4">
            <label className="flex items-center gap-2">
              <Switch aria-label="Modo automático" checked={auto} onCheckedChange={setAuto} />
              Modo automático {auto ? "LIGADO" : "DESLIGADO"}
            </label>
            <label className="flex items-center gap-2">
              <Switch aria-label="Ação corretiva automática" checked={acaoAutomatica} onCheckedChange={setAcaoAutomatica} />
              Ação corretiva automática {acaoAutomatica ? "LIGADA" : "DESLIGADA"}
            </label>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <div className="min-w-0 space-y-4" data-action-parameters>
            <div className="space-y-2">
              <Label>Centro de trabalho</Label>
              <Select value={cfg.workCenter} onValueChange={(v) => { set("workCenter", v); setEstoqueInformado(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS_WORK_CENTERS}>Todos</SelectItem>
                  {(workCenters.length ? workCenters : [workCenterAtual]).filter((wc) => wc !== TODOS_WORK_CENTERS).map((wc) => <SelectItem key={wc} value={wc}>{wc}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="action-h">Projetar quantos dias à frente</Label>
              <Input id="action-h" type="number" min={1} value={cfg.horizonte} onChange={(e) => {
                const h = Math.round(num(e.target.value, 1)); set("horizonte", h);
                setAjuste((a) => ({ ...a, diaInicio: Math.min(a.diaInicio, h) }));
              }} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="action-e">Estoque disponível hoje</Label>
              <Input id="action-e" type="number" min={0} value={estoqueTexto} placeholder="Informe o estoque atual" onChange={(e) => setEstoqueInformado(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="action-max">Estoque máximo</Label>
              <Input id="action-max" type="number" min={0} value={cfg.estoqueMaximo} onChange={(e) => set("estoqueMaximo", num(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>Estoque mínimo</Label>
              <div className="flex gap-2">
                <Button size="sm" variant={cfg.minimoModo === "auto" ? "default" : "outline"} onClick={() => set("minimoModo", "auto")}>Automático</Button>
                <Button size="sm" variant={cfg.minimoModo === "manual" ? "default" : "outline"} onClick={() => set("minimoModo", "manual")}>Manual</Button>
              </div>
              {cfg.minimoModo === "manual" ? <Input aria-label="Estoque mínimo manual" type="number" min={0} value={cfg.estoqueMinimoManual} onChange={(e) => set("estoqueMinimoManual", num(e.target.value))} /> : <p className="text-xs text-muted-foreground">{cfg.pctMinimo}% do máximo = {formatarNumero(estoqueMinimo(cfg))} un.</p>}
            </div>

            <div className="space-y-2">
              <Label>Consumo diário do estoque</Label>
              <Select value={consumo.unidades.trim() !== "" ? "unidades" : consumo.modo} onValueChange={(v: "automatico" | "percentual") => setConsumo((c) => ({ ...c, modo: v, unidades: "" }))}>
                <SelectTrigger aria-label="Consumo diário do estoque"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="automatico">Automático · histórico MES</SelectItem>
                  <SelectItem value="percentual">Manual · % da produção</SelectItem>
                  {consumo.unidades.trim() !== "" ? <SelectItem value="unidades" disabled>Unidades/dia · avançado</SelectItem> : null}
                </SelectContent>
              </Select>
              {consumo.unidades.trim() === "" && consumo.modo === "percentual" ? <div className="flex items-center gap-2">
                <Input aria-label="Consumo percentual da produção" type="number" min={0} max={200} value={consumo.percentual} onChange={(e) => setConsumo((c) => ({ ...c, percentual: Math.min(200, num(e.target.value)) }))} />
                <span className="text-sm text-muted-foreground">%</span>
              </div> : null}
            </div>

            <div className="space-y-1">
              <Label>Tipo de ação corretiva</Label>
              <p className="text-sm text-muted-foreground">{acaoAutomatica ? "Preventiva dinâmica, recalculada a cada dia" : "Ajuste manual com percentual constante"}</p>
            </div>
            {!acaoAutomatica ? <div className="space-y-3">
              <Label htmlFor="action-percent">Ajuste percentual da produção</Label>
              <div className="flex items-center gap-2">
                <Input id="action-percent" className="w-28" type="number" min={-100} max={100} step={1} value={ajuste.percentual} onChange={(e) => setAjuste((a) => ({ ...a, percentual: Math.round(Math.max(-100, Math.min(100, Number(e.target.value) || 0))) }))} />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <Slider aria-label="Ajuste percentual da produção" min={-100} max={100} step={1} value={[ajuste.percentual]} onValueChange={(v) => setAjuste((a) => ({ ...a, percentual: v[0] ?? a.percentual }))} />
              <p className="text-xs text-muted-foreground">Referência: {producaoRef === null ? "—" : formatarNumero(producaoRef)} un./dia → Simulada: {producaoRef === null ? "—" : formatarNumero(producaoRef * (1 + ajuste.percentual / 100))} un./dia.</p>
            </div> : null}

            {auto ? (
              <p className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                No modo automático, a simulação já é atualizada ao alterar qualquer parâmetro; não é necessário clicar em um botão.
              </p>
            ) : (
              <div className="space-y-2">
                <Button className="w-full" onClick={projetar} disabled={Boolean(erro) || producaoRef === null}>Aplicar e simular ação</Button>
                <p className="text-xs text-muted-foreground">No modo manual, as alterações entram no gráfico somente ao clicar neste botão.</p>
              </div>
            )}
            {erro ? <p className="text-xs text-muted-foreground">{erro}</p> : producaoRef === null ? <p className="text-xs text-muted-foreground">Histórico de produção indisponível para este centro.</p> : null}
            <Button variant="link" className="h-auto whitespace-normal p-0 text-left text-xs" onClick={() => setAvancado((v) => !v)}>{avancado ? "Ocultar" : "Mostrar"} configurações avançadas</Button>
            {avancado ? <div className="space-y-3 border-t border-border pt-3">
              {!acaoAutomatica ? <div className="space-y-2">
                <Label htmlFor="action-start">Iniciar ajuste no dia</Label>
                <Input id="action-start" type="number" min={0} max={cfg.horizonte} step={1} value={configAcao.diaInicio} onChange={(e) => setAjuste((a) => ({ ...a, diaInicio: Math.min(cfg.horizonte, Math.round(num(e.target.value))) }))} />
              </div> : null}
              <div className="space-y-1">
                <Label htmlFor="action-consumo-units">Consumo em unidades/dia (opcional)</Label>
                <Input id="action-consumo-units" type="number" min={0} value={consumo.unidades} placeholder="Usar modo selecionado acima" onChange={(e) => setConsumo((c) => ({ ...c, unidades: e.target.value }))} />
              </div>
              {acaoAutomatica ? <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label htmlFor="action-reducao">Redução máxima (%)</Label><Input id="action-reducao" type="number" min={0} max={100} value={limites.reducao} onChange={(e) => setLimites((l) => ({ ...l, reducao: Math.min(100, num(e.target.value)) }))} /></div>
                <div className="space-y-1"><Label htmlFor="action-aumento">Aumento máximo (%)</Label><Input id="action-aumento" type="number" min={0} max={100} value={limites.aumento} onChange={(e) => setLimites((l) => ({ ...l, aumento: Math.min(100, num(e.target.value)) }))} /></div>
                <div className="col-span-2 space-y-1"><Label htmlFor="action-taxa">Mudança máxima por dia (un./dia, opcional)</Label><Input id="action-taxa" type="number" min={0} value={limites.taxa} placeholder="Sem taxa presumida" onChange={(e) => setLimites((l) => ({ ...l, taxa: e.target.value }))} /></div>
                <p className="col-span-2 text-xs text-muted-foreground">Limites de cenário, não capacidade industrial comprovada.</p>
              </div> : null}
              {([["pctMinimo", "Mínimo automático (% do máximo)"], ["pctPreAlerta", "Aviso de proximidade (%)"]] as const).map(([k, label]) => <div key={k} className="space-y-1"><Label className="text-xs">{label}</Label><Input aria-label={label} type="number" min={0} max={99} value={cfg[k]} onChange={(e) => set(k, Math.min(99, num(e.target.value)))} /></div>)}
            </div> : null}
          </div>
          <div className="min-w-0" data-action-results>
            {resultado ? <ResultadoAcao resultado={resultado.acao} base={resultado.base} /> : <div className="flex min-h-[300px] items-center justify-center border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{erro ?? (producaoRef === null ? "Aguardando histórico de produção válido do MES." : "Aguardando simulação.")}</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function situacao(m: RiskMetrics): string {
  const falta = m.primeiroDiaInferior;
  const excesso = m.primeiroDiaSuperior;
  if (falta !== null && (excesso === null || falta <= excesso)) return falta === 0 ? "Estoque abaixo do mínimo hoje" : `Falta prevista no dia ${falta}`;
  if (excesso !== null) return excesso === 0 ? "Estoque acima do máximo hoje" : `Excesso previsto no dia ${excesso}`;
  return "Dentro dos limites críticos";
}

function situacaoAjustada(r: ActionSnapshot): string {
  const fora = r.pontos.find((p) => p.ajustado < r.preAlertaInferior || p.ajustado > r.preAlertaSuperior);
  if (!fora) return "Dentro da faixa preventiva";
  if (fora.estadoAjustado === "RISCO_INFERIOR" || fora.estadoAjustado === "RISCO_SUPERIOR") return situacao(r.ajustado);
  return `Fora da faixa preventiva no dia ${fora.dia}`;
}

function primeiroAlerta(r: ActionSnapshot): string {
  const p = r.pontos.find((ponto) => ponto.estadoAjustado !== "ADEQUADO");
  if (!p) return `Sem alerta até o dia ${r.horizonte}`;
  const quando = p.dia === 0 ? "hoje" : `no dia ${p.dia}`;
  if (p.estadoAjustado === "RISCO_INFERIOR") return `Abaixo do estoque mínimo ${quando}`;
  if (p.estadoAjustado === "RISCO_SUPERIOR") return `Acima do estoque máximo ${quando}`;
  if (p.estadoAjustado === "PROXIMO_MINIMO") return `Próximo do mínimo ${quando}`;
  return `Próximo do máximo ${quando}`;
}

function ResultadoAcao({ resultado: r, base }: { resultado: ActionSnapshot; base: AutoSnapshot }) {
  const classificacao = r.classificacaoIntervencao;
  const rotulo = classificacao === "RISCO_CRIADO" ? "Risco agravado" : classificacao === "RISCO_MISTO" ? "Risco reduzido · atenção" : ({ RISCO_TRANSFERIDO: "Risco transferido", RISCO_EVITADO: "Risco evitado", RISCO_REDUZIDO: "Risco reduzido", RISCO_AGRAVADO: "Risco agravado", RISCO_MANTIDO: "Risco mantido", SEM_RISCO_IDENTIFICADO: "Sem risco identificado" }[classificacao]);
  const cor = classificacao === "RISCO_EVITADO" || classificacao === "SEM_RISCO_IDENTIFICADO" ? "text-success" : classificacao === "RISCO_REDUZIDO" || classificacao === "RISCO_MISTO" ? "text-action-adjusted" : "text-destructive";
  const ajustes = r.pontos.slice(1).map((p) => p.ajustePercentualAplicado ?? 0);
  const temReducao = ajustes.some((a) => a < -1e-8);
  const temAumento = ajustes.some((a) => a > 1e-8);
  const acao = r.modoAcao === "automatico"
    ? temReducao && temAumento ? "Aumento e redução automáticos da produção" : temReducao ? "Redução automática da produção" : temAumento ? "Aumento automático da produção" : "Produção de referência mantida"
    : r.ajustePercentual < 0 ? `Redução manual de ${Math.abs(r.ajustePercentual)}%` : r.ajustePercentual > 0 ? `Aumento manual de ${r.ajustePercentual}%` : "Sem ajuste manual (0%)";

  const foraPreventiva = r.pontos.some((p) => p.ajustado < r.preAlertaInferior || p.ajustado > r.preAlertaSuperior);
  let frase: string;
  if (r.reducaoInsuficienteSemConsumo) frase = "A redução da produção não é suficiente para diminuir o estoque com o consumo informado.";
  else if (r.riscoInicial) frase = `O estoque já está fora dos limites. ${r.primeiroDiaRecuperacao === null ? "Não há recuperação no período projetado." : `Recuperação no dia ${r.primeiroDiaRecuperacao}; ${r.violacoesAposRecuperacao ? `${r.violacoesAposRecuperacao} dia(s) com risco posterior.` : "sem violações posteriores."}`}`;
  else if (r.modoAcao === "automatico" && !r.seguroNoHorizonte) frase = `A intervenção não conseguiu impedir ${r.ajustado.diasAcima ? "o excesso" : "a falta"}. Revise o consumo ou os limites de ajuste.`;
  else if (r.modoAcao === "automatico" && foraPreventiva) frase = "A intervenção reduziu o risco, mas não manteve o estoque dentro da faixa preventiva durante toda a projeção.";
  else if (r.modoAcao === "automatico" && temReducao && !temAumento) frase = "A produção foi reduzida automaticamente para evitar excesso de estoque.";
  else if (r.modoAcao === "automatico" && temAumento && !temReducao) frase = "A produção foi aumentada para evitar falta de estoque.";
  else if (r.modoAcao === "automatico" && temAumento) frase = "A produção foi ajustada automaticamente para conter excesso e falta durante a projeção.";
  else if (r.modoAcao === "automatico") frase = "O estoque permanece dentro da faixa preventiva durante a projeção.";
  else if (classificacao === "RISCO_EVITADO") frase = "O ajuste manual evita o risco previsto durante toda a projeção.";
  else if (classificacao === "SEM_RISCO_IDENTIFICADO") frase = "As duas projeções permanecem dentro dos limites durante a projeção.";
  else frase = "O ajuste não evitou todas as violações. Revise o percentual, o consumo ou o início da intervenção.";

  const valores = [r.estoqueMinimo, r.estoqueMaximo, r.preAlertaInferior, r.preAlertaSuperior, r.original.saldoMinimo, r.original.saldoMaximo, r.ajustado.saldoMinimo, r.ajustado.saldoMaximo];
  const min = Math.min(...valores), max = Math.max(...valores);
  const margem = Math.max(1, (max - min) * 0.08);
  const risco = r.ajustado.diasAbaixo > 0 || r.ajustado.diasAcima > 0;
  const atencao = !risco && r.pontos.some((p) => p.estadoAjustado === "PROXIMO_MINIMO" || p.estadoAjustado === "PROXIMO_MAXIMO");
  const primeiro = r.pontos[0];
  const ultimo = r.pontos[r.pontos.length - 1];
  const saldoOriginal = primeiro && ultimo ? (ultimo.original - primeiro.original) / r.horizonte : 0;
  const saldoAjustado = primeiro && ultimo ? (ultimo.ajustado - primeiro.ajustado) / r.horizonte : 0;
  const consumoMedio = r.pontos.slice(1).reduce((total, p) => total + (p.consumoAjustado ?? 0), 0) / r.horizonte;
  const comSinal = (valor: number) => `${valor >= 0 ? "+" : ""}${formatarNumero(valor)}`;
  return <div className="space-y-4">
    <div className="rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">Situação ajustada</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${risco ? "bg-destructive text-destructive-foreground" : atencao ? "bg-primary text-primary-foreground" : "bg-success text-primary-foreground"}`}>
          {risco ? "RISCO" : atencao ? "ATENÇÃO" : "OK"}
        </span>
        <span>{situacaoAjustada(r)} • {ROTULO_PRODUCAO[base.estadoProducao]}</span>
      </div>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <Info label="Estoque hoje" value={`${formatarNumero(base.estoqueAtual)} un.`} />
        <Info label="Mínimo / Máximo" value={`${formatarNumero(r.estoqueMinimo)} / ${formatarNumero(r.estoqueMaximo)}`} />
        <Info label="Produção média (7 dias)" value={`${formatarNumero(base.producaoRef)} un./dia`} />
        <Info label="Produção mais recente" value={base.producaoAtual === null ? "—" : `${formatarNumero(base.producaoAtual)} un./dia`} />
        <Info label="Faixa de produção" value={`${formatarNumero(base.producaoMin)} – ${formatarNumero(base.producaoMax)} un./dia`} />
        <Info label="Saldo por dia (original / ajustado)" value={`${comSinal(saldoOriginal)} / ${comSinal(saldoAjustado)} un.`} />
        <Info label="Primeiro alerta ajustado" value={primeiroAlerta(r)} />
        <Info label="Atualizado em" value={new Date(r.geradoEm).toLocaleString("pt-BR")} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {r.consumoIndisponivel
          ? "Consumo automático indisponível; a projeção assume consumo nulo nos dias sem histórico."
          : consumoMedio > 0
            ? `Consumo médio considerado na simulação: ${formatarNumero(consumoMedio)} un./dia.`
            : "Projeção sem consumo: as saídas do estoque não estão sendo consideradas."}
      </p>
    </div>
    <div className="grid gap-3 border-b border-border pb-4 text-sm sm:grid-cols-2">
      <Info label="Situação original" value={situacao(r.original)} />
      <Info label="Situação ajustada" value={situacaoAjustada(r)} />
      <Info label="Ação simulada" value={acao} />
      <Info label="Resultado" value={rotulo} color={cor} />
    </div>
    <div className="h-[340px]" aria-label="Gráfico comparativo de estoque">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={r.pontos} margin={{ top: 22, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="dia" stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} />
          <YAxis width={70} domain={[min - margem, max + margem]} stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatarNumero(v)} />
          <Tooltip content={<ActionTooltip />} />
          {r.modoAcao === "manual" ? <ReferenceLine x={r.diaInicio} stroke="var(--muted-foreground)" strokeDasharray="4 3" label={{ value: `Ação · dia ${r.diaInicio}`, fontSize: 10, fill: "var(--muted-foreground)", position: "top" }} /> : null}
          <ReferenceLine y={r.estoqueMaximo} stroke="var(--destructive)" strokeDasharray="6 4" label={{ value: "Máximo", fontSize: 11, fill: "var(--destructive)", position: "insideTopLeft" }} />
          <ReferenceLine y={r.estoqueMinimo} stroke="var(--destructive)" strokeDasharray="6 4" label={{ value: "Mínimo", fontSize: 11, fill: "var(--destructive)", position: "insideBottomLeft" }} />
          <ReferenceLine y={r.preAlertaSuperior} stroke="var(--success)" strokeDasharray="2 4" label={{ value: "Próximo do máximo", fontSize: 10, fill: "var(--success)", position: "insideBottomRight" }} />
          <ReferenceLine y={r.preAlertaInferior} stroke="var(--success)" strokeDasharray="2 4" label={{ value: "Próximo do mínimo", fontSize: 10, fill: "var(--success)", position: "insideTopRight" }} />
          <Line type="linear" dataKey="original" name="Saldo de estoque projetado" stroke="var(--success)" strokeWidth={3.5} dot={false} isAnimationActive={false} />
          <Line type="linear" dataKey="ajustado" name="Saldo de estoque ajustado" stroke="var(--action-adjusted)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line dataKey="ativacaoAjustada" stroke="none" legendType="none" tooltipType="none" dot={{ r: 3, fill: "var(--action-adjusted)", stroke: "var(--background)", strokeWidth: 1 }} activeDot={false} isAnimationActive={false} />
          <Line dataKey="violacaoOriginal" stroke="none" legendType="none" tooltipType="none" dot={{ r: 2, fill: "var(--destructive)", stroke: "var(--destructive)" }} activeDot={false} isAnimationActive={false} />
          <Line dataKey="violacaoAjustada" stroke="none" legendType="none" tooltipType="none" dot={{ r: 2, fill: "var(--action-adjusted)", stroke: "var(--action-adjusted)" }} activeDot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-2"><span className="w-5 border-t-2 border-success" />Saldo de estoque projetado</span>
      <span className="flex items-center gap-2"><span className="w-5 border-t-2 border-action-adjusted" />Saldo de estoque ajustado</span>
      <span className="flex items-center gap-2"><span className="w-5 border-t-2 border-dashed border-destructive" />Máximo</span>
      <span className="flex items-center gap-2"><span className="w-5 border-t-2 border-dashed border-destructive" />Mínimo</span>
      <span className="flex items-center gap-2"><span className="w-5 border-t-2 border-dotted border-success" />Próximo do máximo</span>
      <span className="flex items-center gap-2"><span className="w-5 border-t-2 border-dotted border-success" />Próximo do mínimo</span>
    </div>
    <p className="text-sm"><span className={cor}>{frase}</span>{" "}<span className="text-xs text-muted-foreground">{r.consumoIndisponivel ? "Consumo automático indisponível; a projeção assume consumo nulo nos dias sem histórico. " : ""}{r.projecaoMediaConstante ? "Projeção baseada em produção média constante. " : "Projeção baseada no perfil dos últimos dias válidos de produção. "}{r.modoAcao === "automatico" ? "Limites de ajuste são hipóteses de cenário; capacidade operacional não verificada. " : "Capacidade operacional não verificada. "}Nenhuma alteração na produção real.</span></p>
  </div>;
}

function ActionTooltip({ active, payload }: { active?: boolean; payload?: { payload: ActionPoint }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const ajuste = p.ajustePercentualAplicado;
  return <div className="rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-sm">
    <p className="font-semibold">{p.dia === 0 ? "Hoje" : `Dia ${p.dia}`}</p>
    <p className="mt-1">Original: {formatarNumero(p.original)} un.</p>
    <p>Ajustado: {formatarNumero(p.ajustado)} un.</p>
    <p>Ajuste aplicado: {ajuste === null ? "—" : `${ajuste >= 0 ? "+" : ""}${ajuste.toFixed(1)}%`}</p>
  </div>;
}

function Info({ label, value, color = "text-foreground" }: { label: string; value: string; color?: string }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 font-semibold ${color}`}>{value}</div></div>;
}
