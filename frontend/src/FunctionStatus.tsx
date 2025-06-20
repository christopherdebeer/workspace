import { useEffect, useState } from 'react';
import styled from 'styled-components';

type Status = 'loading' | 'ok' | 'error';

const Indicator = styled.span<{ status: Status }>`
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: ${({ status }) =>
    status === 'ok' ? 'green' : status === 'error' ? 'red' : 'gray'};
`;

export default function FunctionStatus({ url }: { url: string }) {
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    fetch(url)
      .then((r) => {
        if (r.ok) {
          setStatus('ok');
        } else {
          setStatus('error');
        }
      })
      .catch(() => setStatus('error'));
  }, [url]);

  return <Indicator status={status} title={status} />;
}
