import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, login } from '../api';

export default function Login() {
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(password);
      nav('/');
    } catch (err) {
      const s = err instanceof ApiError ? err.status : 0;
      setError(s === 401 ? 'Senha incorreta.' : s === 429 ? 'Muitas tentativas. Aguarde e tente novamente.' : 'Erro ao entrar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4 rounded-lg border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
        <h1 className="text-xl font-semibold">Leituras</h1>
        <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha"
          className="w-full rounded border border-stone-300 bg-transparent px-3 py-2 dark:border-stone-700" />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button disabled={busy || !password} className="w-full rounded bg-emerald-600 py-2 font-medium text-white disabled:opacity-50">Entrar</button>
      </form>
    </div>
  );
}
