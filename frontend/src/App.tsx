import styled from 'styled-components';
import { useEffect, useState } from 'react';
import FunctionStatus from './FunctionStatus';

const apiUrl = import.meta.env.VITE_FUNCTION_URL as string;

const Container = styled.div`
  padding: 1rem;
`;

export default function App() {
  const [response, setResponse] = useState<string>('');

  useEffect(() => {
    fetch(apiUrl)
      .then((r) => r.json())
      .then((data) => setResponse(JSON.stringify(data)))
      .catch((err) => setResponse(String(err)));
  }, []);

  return (
    <Container>
      <h1>Hello from React</h1>
      <FunctionStatus url={apiUrl} />
      {response && <pre>{response}</pre>}
    </Container>
  );
}
