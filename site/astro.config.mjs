// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// GitHub Pages project site: https://jackdo68.github.io/csharp-dotnet-recap/
export default defineConfig({
  site: 'https://jackdo68.github.io',
  base: '/csharp-dotnet-recap/',
  integrations: [
    starlight({
      title: 'C# .NET Recap',
      description:
        'C# and .NET for Node.js + TypeScript developers — the fundamental differences, taught by building a Payment API.',
      logo: { src: './src/assets/logo.svg', alt: 'C# .NET Recap' },
      favicon: '/favicon.svg',
      expressiveCode: {
        // Wrap long lines instead of forcing a horizontal scrollbar.
        // preserveIndent keeps wrapped continuation lines aligned under their code.
        defaultProps: { wrap: true, preserveIndent: true },
      },
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
        { label: 'Topic 3 · Runtime Types', items: [{ autogenerate: { directory: 'topic-3-runtime-types-and-compilation' } }] },
        { label: 'Topic 4 · Errors & Exceptions', items: [{ autogenerate: { directory: 'topic-4-errors-and-failure-philosophy' } }] },
        { label: 'Topic 5 · Web API + EF Core', items: [{ autogenerate: { directory: 'topic-5-web-api-and-di' } }] },
        { label: 'Topic 6 · EF Core Deep Dive', items: [{ autogenerate: { directory: 'topic-6-data-access-and-testing' } }] },
        { label: 'Topic 7 · Concurrency & Threading', items: [{ autogenerate: { directory: 'topic-7-concurrency-and-threading' } }] },
        { label: 'Topic 8 · .NET Standard Library', items: [{ autogenerate: { directory: 'topic-8-dotnet-standard-library' } }] },
        { label: 'Topic 9 · Authentication', items: [{ autogenerate: { directory: 'topic-9-authentication' } }] },
        { label: 'Topic 10 · Production', items: [{ autogenerate: { directory: 'topic-10-production' } }] },
        { label: 'Topic 11 · Testing', items: [{ autogenerate: { directory: 'topic-11-testing' } }] },
        { label: 'Topic 12 · Advanced Patterns', items: [{ autogenerate: { directory: 'topic-12-advanced-patterns' } }] },
      ],
    }),
  ],
});
