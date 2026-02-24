import { ssr } from "@config";
import Layout from "@/ssr/Layout";

/** 404 Not Found page. */
export default ssr((c) => {
  c.status(404);
  return (
    <Layout c={c} title="Page Not Found">
      <div class="max-w-sm mx-auto flex flex-col items-center gap-6 py-16">
        <div class="text-7xl font-light text-gray-300 dark:text-gray-600">404</div>

        <div class="text-center">
          <h1 class="text-lg font-medium text-gray-900 dark:text-gray-100">Oops, nothing here!</h1>
          <p class="mt-1 text-sm text-dimmed">This page took a wrong turn somewhere.</p>
        </div>

        <a href="/" class="btn-primary btn-sm">
          <i class="ti ti-home" />
          <span>Take me home</span>
        </a>
      </div>
    </Layout>
  );
});
