import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import './index.css';
import Layout from './components/Layout';
import Login from './pages/Login';
import DashboardPage from './pages/DashboardPage';
import BookPage from './pages/BookPage';
import HabitoPage from './pages/HabitoPage';
import LivrosPage from './pages/LivrosPage';
import ConquistasPage from './pages/ConquistasPage';
import ConfiguracoesPage from './pages/ConfiguracoesPage';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/livros" element={<LivrosPage />} />
            <Route path="/livros/:md5" element={<BookPage />} />
            <Route path="/habito" element={<HabitoPage />} />
            <Route path="/conquistas" element={<ConquistasPage />} />
            <Route path="/configuracoes" element={<ConfiguracoesPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
