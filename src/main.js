import { createApp } from 'vue';
import { defineCustomElements } from 'jeep-sqlite/loader';
import App from './App.vue';

await defineCustomElements(window);
if (!document.querySelector('jeep-sqlite')) {
  const jeepSqlite = document.createElement('jeep-sqlite');
  // jeep-sqlite defaults wasmPath to the absolute `/assets`, which 404s once
  // the app is served from a subpath (e.g. GitHub Pages' /kiwami/). Point it
  // at the same base Vite resolved everything else against.
  jeepSqlite.wasmPath = `${import.meta.env.BASE_URL}assets`;
  document.body.appendChild(jeepSqlite);
}
await customElements.whenDefined('jeep-sqlite');

createApp(App).mount('#app');
