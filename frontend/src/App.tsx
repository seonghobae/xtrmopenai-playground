import { Routes, Route, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

// Placeholder components
const LoginPage = () => (
  <div style={{ padding: '2rem' }}>
    <h1>OpenAI Playground</h1>
    <p>MCP Test Harness & Responses API Testing Platform</p>
    <button onClick={() => window.location.href = '/api/auth/login'}>
      Login with Casdoor
    </button>
  </div>
);

const DashboardPage = () => (
  <div style={{ padding: '2rem' }}>
    <h1>Dashboard</h1>
    <p>Welcome to OpenAI Playground</p>
    <nav>
      <ul>
        <li><a href="/mcp">MCP Test Harness</a></li>
        <li><a href="/responses">Responses API Testing</a></li>
        <li><a href="/usage">Usage & Cost Monitoring</a></li>
        <li><a href="/audit">Audit Logs</a></li>
      </ul>
    </nav>
  </div>
);

const McpPage = () => (
  <div style={{ padding: '2rem' }}>
    <h1>MCP Test Harness</h1>
    <p>Register and test MCP servers</p>
  </div>
);

const ResponsesPage = () => (
  <div style={{ padding: '2rem' }}>
    <h1>Responses API Testing</h1>
    <p>Test OpenAI Responses API with Structured Outputs and Streaming</p>
  </div>
);

const UsagePage = () => (
  <div style={{ padding: '2rem' }}>
    <h1>Usage & Cost Monitoring</h1>
    <p>Track token usage and costs</p>
  </div>
);

const AuditPage = () => (
  <div style={{ padding: '2rem' }}>
    <h1>Audit Logs</h1>
    <p>View security audit logs</p>
  </div>
);

function App() {
  // Check authentication status
  const { data: user, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        const response = await axios.get('/api/auth/me', {
          withCredentials: true,
        });
        return response.data.success ? response.data.data : null;
      } catch (err) {
        return null;
      }
    },
  });

  if (isLoading) {
    return <div>Loading...</div>;
  }

  const isAuthenticated = !!user;

  return (
    <Routes>
      <Route
        path="/"
        element={isAuthenticated ? <Navigate to="/dashboard" /> : <LoginPage />}
      />
      <Route
        path="/dashboard"
        element={isAuthenticated ? <DashboardPage /> : <Navigate to="/" />}
      />
      <Route
        path="/mcp"
        element={isAuthenticated ? <McpPage /> : <Navigate to="/" />}
      />
      <Route
        path="/responses"
        element={isAuthenticated ? <ResponsesPage /> : <Navigate to="/" />}
      />
      <Route
        path="/usage"
        element={isAuthenticated ? <UsagePage /> : <Navigate to="/" />}
      />
      <Route
        path="/audit"
        element={isAuthenticated ? <AuditPage /> : <Navigate to="/" />}
      />
    </Routes>
  );
}

export default App;
