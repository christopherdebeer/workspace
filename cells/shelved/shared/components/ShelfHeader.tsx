import * as React from 'react';
import styled from '../styled';
import { theme } from '../theme';
import { PrimaryButton } from './Layout';

const Header = styled.header`
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 16px;
  padding: 10px 2px 22px;
`;
const Kicker = styled.div`
  color: ${theme.clay};
  font: 700 11px/1 ${theme.mono};
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: 8px;
`;
const Title = styled.h1`
  margin: 0;
  font: 500 clamp(38px, 8vw, 72px)/0.9 ${theme.serif};
  letter-spacing: -0.045em;
`;
const Subtitle = styled.p`
  max-width: 560px;
  margin: 10px 0 0;
  color: ${theme.quiet};
  line-height: 1.5;
`;

export function ShelfHeader({ onAdd }: { onAdd?: () => void }): React.JSX.Element {
  return (
    <Header>
      <div>
        <Kicker>Your bookshelf</Kicker>
        <Title>The books you live with.</Title>
        <Subtitle>Keep track of what you’re reading, and choose which books friends and neighbours can ask for.</Subtitle>
      </div>
      {onAdd ? <PrimaryButton onClick={onAdd}>＋ add a book</PrimaryButton> : null}
    </Header>
  );
}
