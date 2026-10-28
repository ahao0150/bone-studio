import { registerBuiltinCapabilities } from './ai/capabilities';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

// 整页挡住浏览器自带右键菜单。preventDefault 不打断应用自己的 contextmenu（舞台菜单等仍会弹出）。
document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerBuiltinCapabilities();
