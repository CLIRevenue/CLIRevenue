# CLIRevenue SDK

CLIRevenue SDK provides a comprehensive ad delivery solution with a powerful CLI for setup and management.

## Installation

```bash
npm install @clirevenue/sdk
```

## CLI Commands

The SDK includes a built-in CLI that can be accessed via `npx clirevenue`:

### Setup

Run the interactive setup to configure your ad delivery:

```bash
npx clirevenue setup
```

This will:
- Detect your Vite + React project
- Install the SDK
- Configure your environment
- Create ad components

### Ads Panel

Open the Ad Slot Configuration Panel:

```bash
npx clirevenue ads
```

This opens the terminal-based Ad Slot Configuration Panel for managing ad placements.

## Usage

After setup, import and use the ad components in your React application:

```jsx
import CLIRevenueAd from './components/CLIRevenueAd';

function App() {
  return (
    <div>
      <h1>My App</h1>
      <CLIRevenueAd size="responsive" />
    </div>
  );
}
```

## Project Configuration

After running `npx clirevenue setup`, the following files will be created:

- `.env.local` - Environment variables with your publishable key
- `src/lib/clirevenue.js` - CLIRevenue library wrapper
- `src/components/CLIRevenueAd.jsx` - Ad component

## Features

- **Automatic Project Detection** - Detects Vite + React projects
- **Interactive Setup** - Guided configuration with validation
- **Key Verification** - Validates publisher keys against the API
- **Placement Selection** - Choose from your ad placements
- **Size Configuration** - Multiple size options (responsive, custom)
- **Integration Generation** - Auto-generates all necessary files

## SDK Version

Version: 2.0.0

## License

MIT
