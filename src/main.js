import { createApp } from 'vue';
import { defineCustomElements } from 'jeep-sqlite/loader';
import App from './App.vue';

await defineCustomElements(window);
if (!document.querySelector('jeep-sqlite')) {
  document.body.appendChild(document.createElement('jeep-sqlite'));
}
await customElements.whenDefined('jeep-sqlite');

createApp(App).mount('#app');
