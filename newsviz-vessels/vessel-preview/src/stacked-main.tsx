import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import StackedVessels from './StackedVessels.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StackedVessels/>
  </StrictMode>,
);
