import { flowtapeApiHandler } from '@vvedantb/flowtape/next';

// Pages Router variant, for apps without the App Router. A real app uses `/api/flowtape` and one router only.
export default flowtapeApiHandler({ endpoint: '/api/flowtape-pages' });
