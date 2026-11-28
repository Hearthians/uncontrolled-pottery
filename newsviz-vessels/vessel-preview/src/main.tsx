import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import ThreeVessels from './ThreeVessels.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThreeVessels/>
  </StrictMode>,
);
