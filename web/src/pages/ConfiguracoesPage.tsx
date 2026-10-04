import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PainelConfig, PainelItem } from '@leituras/shared';
import { ApiError, getPainelConfig, patchPainelConfig, resetPainelConfig } from '../api';
import { Card } from '../components/Card';

export const PAINEL_LABELS: Record<PainelItem, string> = {
  foco: 'Foco',
  livrosConcluidos: 'Indicador de livros concluídos',
  horas: 'Indicador de horas lidas',
  paginas: 'Indicador de páginas',
  atividade: 'Atividade anual',
  concluidosPorMes: 'Livros concluídos por mês',
  todosLivros: 'Lista de todos os livros',
};

export default function ConfiguracoesPage() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['painel-config'], queryFn: getPainelConfig });
  const onSaved = (data: PainelConfig) => {
    qc.setQueryData(['painel-config'], data);
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const save = useMutation({ mutationFn: patchPainelConfig, onSuccess: onSaved });
  const reset = useMutation({ mutationFn: resetPainelConfig, onSuccess: onSaved });
  const error = (save.error ?? reset.error) as Error | null;
  const busy = save.isPending || reset.isPending;
  const items = Object.keys(PAINEL_LABELS) as PainelItem[];

  return (
    <>
      <h1 className="page-title">Configurações</h1>
      <Card title="Itens do painel">
        <p className="muted mb-3">
          Escolha o que aparece no Painel. Ocultar só esconde a apresentação: nenhum dado é apagado e os cálculos não mudam.
          A preferência vale para esta instância (fica salva no servidor), então é a mesma em todos os navegadores e dispositivos.
        </p>
        {config.isError && <p className="error">Erro ao carregar as configurações.</p>}
        {config.data && (
          <fieldset className="grid grid-cols-1 gap-1 sm:grid-cols-2" disabled={busy}>
            <legend className="sr-only">Itens exibidos no Painel</legend>
            {items.map((item) => (
              <label key={item} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={config.data[item]}
                  onChange={(e) => save.mutate({ [item]: e.target.checked })}
                />
                <span>{PAINEL_LABELS[item]}</span>
              </label>
            ))}
          </fieldset>
        )}
        {error && <p className="error mt-3" role="alert">{error instanceof ApiError ? error.message : 'Não foi possível salvar.'}</p>}
        <div className="mt-4">
          <button type="button" className="btn" onClick={() => reset.mutate()} disabled={busy || !config.data}>
            Restaurar padrão (mostrar tudo)
          </button>
        </div>
      </Card>
    </>
  );
}
