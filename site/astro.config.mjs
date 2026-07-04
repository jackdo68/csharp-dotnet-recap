// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// GitHub Pages project site: https://jackdo68.github.io/csharp-dotnet-recap/
export default defineConfig({
  site: 'https://jackdo68.github.io',
  base: '/csharp-dotnet-recap',
  integrations: [
    starlight({
      title: 'C# .NET Recap',
      description:
        'C# and .NET for Node.js + TypeScript developers — the fundamental differences, taught by building a Loan Application API.',
      logo: { src: './src/assets/logo.svg', alt: 'C# .NET Recap' },
      favicon: '/favicon.svg',
      head: [
        // Social preview (Open Graph + Twitter). Absolute URLs required.
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://jackdo68.github.io/csharp-dotnet-recap/og.png' } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://jackdo68.github.io/csharp-dotnet-recap/og.png' } },
      ],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Guide', slug: 'guide' },
            { label: 'Commands', slug: 'commands' },
            { label: 'Setup', slug: 'setup' },
          ],
        },
        { label: 'Topic 1 · Platform & Tooling', items: [{ autogenerate: { directory: 'topic-1-platform-and-tooling' } }] },
        { label: 'Topic 2 · Language & Type System', items: [{ autogenerate: { directory: 'topic-2-language-and-type-system' } }] },
        { label: 'Topic 3 · Runtime Types & Compilation', items: [{ autogenerate: { directory: 'topic-3-runtime-types-and-compilation' } }] },
        { label: 'Topic 4 · Errors & Failure Philosophy', items: [{ autogenerate: { directory: 'topic-4-errors-and-failure-philosophy' } }] },
        { label: 'Topic 5 · Web API & Dependency Injection', items: [{ autogenerate: { directory: 'topic-5-web-api-and-di' } }] },
        { label: 'Topic 6 · Data Access & Testing', items: [{ autogenerate: { directory: 'topic-6-data-access-and-testing' } }] },
        { label: 'Topic 7 · Concurrency & Threading', items: [{ autogenerate: { directory: 'topic-7-concurrency-and-threading' } }] },
      ],
    }),
  ],
});
