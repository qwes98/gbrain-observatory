import { hydrateRoot } from 'react-dom/client';
import { HydrationFixture } from './hydration-tree';
import '../../src/app/globals.css';

hydrateRoot(document.getElementById('root')!, <HydrationFixture />);
