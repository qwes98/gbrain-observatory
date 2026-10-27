import { renderToString } from 'react-dom/server';
import { HydrationFixture } from './hydration-tree';

export function render() {
  return renderToString(<HydrationFixture />);
}
