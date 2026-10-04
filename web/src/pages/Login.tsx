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
      <form onSubmit={submit} className="card w-full max-w-xs space-y-4 p-6">
        <h1 className="page-title text-xl">Leituras</h1>
        <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha"
          className="input" />
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={busy || !password} className="btn-primary w-full">Entrar</button>
      </form>
    </div>
  );
}
