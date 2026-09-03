import * as React from 'react';
import styled from '../styled';
import { theme } from '../theme';

const Frame = styled.div`
  position: relative;
  overflow: hidden;
  flex: none;
  border-radius: 5px 9px 9px 5px;
  background: linear-gradient(145deg, ${theme.moss}, #1d382f);
  box-shadow: 5px 8px 16px rgba(45, 34, 28, .2), inset 4px 0 rgba(255,255,255,.1);
  &::after { content: ''; position: absolute; z-index: 2; inset: 0 auto 0 7px; width: 1px; background: rgba(255,255,255,.22); }
`;
const Image = styled.img`position: absolute; z-index: 1; inset: 0; width: 100%; height: 100%; object-fit: cover;`;
const LetterCover = styled.div`
  display: grid; place-items: center; height: 100%; padding: 10px;
  color: #fff8e9; font: 600 12px/1.25 ${theme.serif}; text-align: center;
`;

export function BookCover({ title, url, width = 92, height = 138 }: { title: string; url?: string; width?: number; height?: number }): React.JSX.Element {
  return <Frame style={{ width, height }}><LetterCover>{title}</LetterCover>{url ? <Image src={url} alt={`Cover of ${title}`} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : null}</Frame>;
}
