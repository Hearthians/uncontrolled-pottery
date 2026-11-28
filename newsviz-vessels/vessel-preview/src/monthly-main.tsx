import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import MonthlyVessels from './MonthlyVessels.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MonthlyVessels/>
  </StrictMode>,
);
