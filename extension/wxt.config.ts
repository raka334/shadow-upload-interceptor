import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifest: {
    name: 'SecureIntent Shadow Upload',
    description: 'Stops files containing private keys before they reach the page.',
    permissions: ['nativeMessaging'],
    minimum_chrome_version: '148',
    // Chrome 148+: typed arrays are copied between the content script and MV3
    // worker. Native Messaging itself remains JSON-only.
    message_serialization: 'structured_clone',
  },
});
