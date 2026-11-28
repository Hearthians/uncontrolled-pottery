import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import FlutedVessels from './FlutedVessels.tsx';

createRoot(document.getElementById('root')!).render(<StrictMode><FlutedVessels/></StrictMode>);
