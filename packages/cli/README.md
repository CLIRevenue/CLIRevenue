# CLIRevenue CLI

Install the CLIRevenue SDK and configure ad delivery in your project.

## Usage

```bash
npx clirevenue setup
```

## What it does

1. Detects Vite + React projects
2. Installs `@clirevenue/sdk`
3. Verifies your publishable key against the CLIRevenue backend
4. Lists available placements for your publisher
5. Lets you choose an ad size
6. Generates `.env.local`, `src/lib/clirevenue.js`, and `src/components/CLIRevenueAd.jsx`

## Requirements

- Node.js >= 18
- A Vite + React project
- A CLIRevenue publishable key (`pk_test_...` or `pk_live_...`)

## Supported project types

- Vite + React (v1)
- Additional frameworks can be added via `src/detect/project.ts`

## License

CLIRevenue is proprietary software. See the repository's LICENSE file for the applicable terms.
