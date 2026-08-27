import { defineContentScript } from '#imports';
import { installUploadGuard } from '../intercept/uploadGuard';

export default defineContentScript({
  matches: ['http://localhost:4173/*', 'http://127.0.0.1:4173/*'],
  runAt: 'document_start',
  main(ctx) {
    const remove = installUploadGuard();
    ctx.onInvalidated(remove);
  },
});
