import * as React from 'react';
import styled from '../styled';
import { theme } from '../theme';

export const Page = styled.div`
  min-height: 100svh;
  padding: max(20px, env(safe-area-inset-top)) 16px max(40px, env(safe-area-inset-bottom));
  background: ${theme.paper};
`;

export const Shell = styled.main`
  width: min(100%, 1180px);
  margin: 0 auto;
`;

export const Panel = styled.section`
  background: ${theme.paperRaised};
  border: 1px solid ${theme.line};
  border-radius: 18px;
  box-shadow: ${theme.shadow};
`;

export const PrimaryButton = styled.button`
  border: 0;
  border-radius: 999px;
  padding: 11px 17px;
  background: ${theme.moss};
  color: #fffdf7;
  font-weight: 700;
  cursor: pointer;
  &:disabled { opacity: 0.5; cursor: wait; }
  &:focus-visible { outline: 3px solid ${theme.gold}; outline-offset: 2px; }
`;

export const ClayButton = styled(PrimaryButton)`background: ${theme.clay};`;

export const QuietButton = styled.button`
  border: 1px solid ${theme.line};
  border-radius: 999px;
  padding: 9px 14px;
  background: ${theme.paperRaised};
  color: ${theme.ink};
  font-weight: 650;
  cursor: pointer;
`;

export const Field = styled.input`
  width: 100%;
  border: 1px solid ${theme.line};
  border-radius: 10px;
  padding: 11px 12px;
  background: #fffdf7;
  color: ${theme.ink};
  &:focus { outline: 2px solid ${theme.gold}; outline-offset: 1px; }
`;

export const Select = styled.select`
  width: 100%;
  border: 1px solid ${theme.line};
  border-radius: 10px;
  padding: 11px 12px;
  background: #fffdf7;
  color: ${theme.ink};
`;
