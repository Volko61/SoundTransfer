# Contributing to SSTV Decoder

Thank you for your interest in contributing to the SSTV Decoder project! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Testing Requirements](#testing-requirements)
- [Code Quality](#code-quality)
- [Submitting Changes](#submitting-changes)
- [Adding New SSTV Modes](#adding-new-sstv-modes)

## Getting Started

### Fork the Repository

1. Fork the repository on GitHub
2. Clone your fork locally:

```bash
git clone https://github.com/YOUR_USERNAME/sstv-decoder.git
cd sstv-decoder
```

3. Add the upstream repository as a remote:

```bash
git remote add upstream https://github.com/smolgroot/sstv-decoder.git
```

4. Install dependencies:

```bash
npm install
```

### Create a Branch

Always create a new branch for your work. Use descriptive branch names that indicate the purpose of your changes:

```bash
# For new features
git checkout -b feature/add-scottie-s1-mode

# For bug fixes
git checkout -b fix/sync-detection-timing

# For documentation
git checkout -b docs/improve-api-documentation

# For tests
git checkout -b test/add-martin-decoder-tests
```

Keep your branch up to date with the main branch:

```bash
git fetch upstream
git rebase upstream/main
```

## Development Workflow

### 1. Make Your Changes

- Write clean, readable code following the existing code style
- Use TypeScript for type safety
- Add comments for complex algorithms or non-obvious logic
- Follow the existing project structure

### 2. Run Tests Locally

Before committing, ensure all tests pass:

```bash
# Run all tests
npm test

# Run tests in watch mode during development
npm run test:watch

# Check test coverage
npm run test:coverage
```

**All tests must pass before submitting a pull request.**

### 3. Check Code Quality

Run the linters to ensure code quality:

```bash
# Run ESLint
npm run lint

# Run TypeScript type checking
npm run build
```

Fix any linting errors or warnings before committing.

## Testing Requirements

### Writing Tests

All new code should include appropriate tests. The project uses Jest for testing.

#### Test Coverage Requirements

- **Minimum coverage**: 70% for statements, branches, functions, and lines
- **Core algorithms**: Aim for 90%+ coverage
- **DSP components**: Should have comprehensive test coverage

#### Test File Organization

Tests are located in `src/lib/sstv/__tests__/`:

- `{component}.test.ts` - Tests for the corresponding component
- Use descriptive test names with `describe` and `test` blocks
- Group related tests using nested `describe` blocks

#### Example Test Structure

```typescript
import { YourComponent } from '../your-component';

describe('YourComponent', () => {
  describe('Initialization', () => {
    test('creates instance with valid parameters', () => {
      const component = new YourComponent(sampleRate);
      expect(component).toBeDefined();
    });
  });

  describe('Core Functionality', () => {
    test('processes input correctly', () => {
      const component = new YourComponent(sampleRate);
      const result = component.process(input);
      expect(result).toEqual(expectedOutput);
    });
  });

  describe('Edge Cases', () => {
    test('handles empty input gracefully', () => {
      const component = new YourComponent(sampleRate);
      const result = component.process(emptyInput);
      expect(result).toBeNull();
    });
  });
});
```

### Adding New SSTV Mode Tests

When implementing a new SSTV mode decoder, you **must** create a corresponding test file:

#### Line Decoder Test Template

Create `src/lib/sstv/__tests__/{mode}-line-decoder.test.ts`:

```typescript
import { YourModeLineDecoder } from '../your-mode-line-decoder';

describe('YourModeLineDecoder', () => {
  const sampleRate = 48000;

  describe('Initialization', () => {
    test('creates instance with valid sample rate', () => {
      const decoder = new YourModeLineDecoder(sampleRate);
      expect(decoder).toBeDefined();
      expect(decoder).toBeInstanceOf(YourModeLineDecoder);
    });

    test('handles different sample rates', () => {
      expect(() => new YourModeLineDecoder(44100)).not.toThrow();
      expect(() => new YourModeLineDecoder(48000)).not.toThrow();
    });
  });

  describe('Scan Line Decoding', () => {
    test('returns null for insufficient buffer', () => {
      const decoder = new YourModeLineDecoder(sampleRate);
      const shortBuffer = new Float32Array(100);

      const result = decoder.decodeScanLine(shortBuffer, 0, 0);
      expect(result).toBeNull();
    });

    test('processes valid scan line buffer', () => {
      const decoder = new YourModeLineDecoder(sampleRate);
      const buffer = new Float32Array(expectedBufferSize);
      buffer.fill(0); // Neutral gray

      const result = decoder.decodeScanLine(buffer, 0, 0);
      expect(result).not.toBeNull();

      if (result !== null) {
        expect(result.pixels).toBeDefined();
        expect(result.width).toBe(expectedWidth);
        expect(result.height).toBe(expectedHeight);
      }
    });
  });

  describe('Decoded Line Structure', () => {
    test('returns RGBA pixel data', () => {
      const decoder = new YourModeLineDecoder(sampleRate);
      const buffer = new Float32Array(expectedBufferSize);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);
      expect(result).not.toBeNull();

      if (result !== null) {
        expect(result.pixels).toBeInstanceOf(Uint8ClampedArray);
        expect(result.pixels.length % 4).toBe(0);
      }
    });

    test('pixel values are in valid range', () => {
      const decoder = new YourModeLineDecoder(sampleRate);
      const buffer = new Float32Array(expectedBufferSize);
      buffer.fill(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);
      expect(result).not.toBeNull();

      if (result !== null) {
        for (let i = 0; i < result.pixels.length; i++) {
          expect(result.pixels[i]).toBeGreaterThanOrEqual(0);
          expect(result.pixels[i]).toBeLessThanOrEqual(255);
        }
      }
    });
  });

  describe('Edge Cases', () => {
    test('handles empty buffer gracefully', () => {
      const decoder = new YourModeLineDecoder(sampleRate);
      const buffer = new Float32Array(0);

      const result = decoder.decodeScanLine(buffer, 0, 0);
      expect(result).toBeNull();
    });

    test('handles extreme values', () => {
      const decoder = new YourModeLineDecoder(sampleRate);
      const buffer = new Float32Array(expectedBufferSize);
      buffer.fill(100); // Extreme positive

      expect(() => {
        decoder.decodeScanLine(buffer, 0, 0);
      }).not.toThrow();
    });
  });
});
```

#### Required Test Cases for Line Decoders

1. **Initialization**
   - Valid instantiation
   - Multiple sample rates (44.1kHz, 48kHz, 96kHz)

2. **Scan Line Decoding**
   - Insufficient buffer handling
   - Valid buffer processing
   - Frequency offset handling

3. **Output Structure**
   - Correct resolution (width × height)
   - RGBA pixel format
   - Valid pixel value range (0-255)

4. **Edge Cases**
   - Empty buffers
   - Extreme input values
   - Boundary conditions

5. **Sample Rate Scaling**
   - Timing scales correctly with sample rate
   - Output resolution remains consistent

### Checking Coverage

After adding tests, check that coverage meets requirements:

```bash
npm run test:coverage
```

The output shows coverage for each file:

```
File                      | % Stmts | % Branch | % Funcs | % Lines |
--------------------------|---------|----------|---------|---------|
your-component.ts         |   95.5  |   87.5   |   100   |   96.2  |
```

Aim for:
- **Core algorithms**: 90%+ coverage
- **Line decoders**: 95%+ coverage
- **DSP components**: 90%+ coverage
- **Utility functions**: 100% coverage

## Code Quality

### TypeScript Guidelines

- Enable strict type checking
- Avoid `any` types - use proper types or `unknown`
- Use interfaces for public APIs
- Document complex types with JSDoc comments

### Code Style

- Use 2 spaces for indentation
- Use single quotes for strings
- Add semicolons at the end of statements
- Use meaningful variable and function names
- Keep functions small and focused (single responsibility)

### Comments and Documentation

- Add JSDoc comments for public functions and classes
- Document complex algorithms with explanatory comments
- Reference original implementations when porting code
- Update relevant `.md` files in the `doc/` directory

### Running Linters

```bash
# Check for linting issues
npm run lint

# Auto-fix linting issues (when possible)
npm run lint -- --fix

# Type check
npx tsc --noEmit
```

## Submitting Changes

### Before Creating a Pull Request

Checklist:

- [ ] All tests pass (`npm test`)
- [ ] Test coverage meets requirements (`npm run test:coverage`)
- [ ] No linting errors (`npm run lint`)
- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] Code follows project style guidelines
- [ ] New features include tests
- [ ] Documentation is updated (README, doc/ files)
- [ ] Commits are clean and descriptive

### Commit Messages

Write clear, descriptive commit messages:

```bash
# Good commit messages
git commit -m "feat: add Scottie S1 mode decoder with interlaced RGB"
git commit -m "fix: correct sync detection timing for PD180 mode"
git commit -m "test: add comprehensive tests for Martin M1 decoder"
git commit -m "docs: update PD180 specifications with SNR details"

# Less helpful commit messages (avoid these)
git commit -m "updates"
git commit -m "fix bug"
git commit -m "wip"
```

Use conventional commit prefixes:
- `feat:` - New features
- `fix:` - Bug fixes
- `test:` - Adding or updating tests
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `chore:` - Build process or tooling changes

### Push Your Changes

```bash
# Push to your fork
git push origin your-branch-name
```

### Create a Pull Request

1. Go to the original repository on GitHub
2. Click "New Pull Request"
3. Select your fork and branch
4. Write a comprehensive PR title and description

#### PR Title Format

Use a clear, descriptive title:

```
feat: Add Scottie S1 mode decoder with RGB sequential encoding
fix: Correct sync pulse detection for weak signals
test: Add comprehensive tests for PD180 line decoder
docs: Improve DSP algorithm documentation
```

#### PR Description Template

```markdown
## Description

Brief description of what this PR does and why.

## Changes

- List of specific changes made
- Any new files added
- Any files modified or deleted

## Testing

- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] Test coverage: X% (meets 70% minimum)
- [ ] Manual testing performed

## Related Issues

Fixes #123 (if applicable)
Relates to #456 (if applicable)

## Screenshots/Output

(If applicable, include screenshots or example outputs)

## Checklist

- [ ] Code follows project style guidelines
- [ ] Tests pass locally
- [ ] Linters pass
- [ ] Documentation updated
- [ ] Commit messages are clear and descriptive
```

### Code Review Process

- Maintainers will review your PR
- Address any requested changes
- Update your PR by pushing new commits to your branch
- Once approved, your PR will be merged

## Adding New SSTV Modes

When adding a new SSTV mode (e.g., Scottie S1, Martin M1), follow this checklist:

### 1. Research the Mode

- Find official specifications
- Understand timing, resolution, and color encoding
- Check reference implementations
- Document SNR characteristics and typical use cases

### 2. Add Mode Specifications

Update `src/lib/sstv/constants.ts`:

```typescript
export const YOUR_MODE: SSTVMode = {
  name: 'Your Mode Name',
  resolution: { width: 320, height: 240 },
  scanLineTime: 0.428, // seconds
  syncPulseTime: 0.009, // seconds
  // ... other specifications
};
```

### 3. Create Line Decoder

Create `src/lib/sstv/your-mode-line-decoder.ts`:

- Implement timing calculations
- Implement color decoding (YUV, RGB, etc.)
- Handle sample rate scaling
- Add debug logging if needed

### 4. Create Comprehensive Tests

Create `src/lib/sstv/__tests__/your-mode-line-decoder.test.ts`:

- Follow the test template above
- Aim for 95%+ coverage
- Test all edge cases
- Verify color conversion accuracy

### 5. Update Constants Tests

Add tests for your mode in `src/lib/sstv/__tests__/constants.test.ts`.

### 6. Update Main Decoder

Update `src/lib/sstv/decoder.ts` to integrate the new mode.

### 7. Update Documentation

- Add mode to README.md supported modes table
- Create `doc/YOUR_MODE.md` with detailed specifications
- Update `doc/MODE_COMPARISON.md`
- Add usage instructions

### 8. Verify Everything

```bash
npm test                  # All tests pass
npm run test:coverage     # Coverage ≥ 70%
npm run lint              # No linting errors
npm run build             # Builds successfully
```

## Questions?

If you have questions or need help:

- Open an issue for discussion
- Check existing issues and PRs for similar work
- Review the documentation in the `doc/` directory
- Look at existing decoder implementations as examples

## License

By contributing to this project, you agree that your contributions will be licensed under the same 0BSD license as the project.

Thank you for contributing to SSTV Decoder! 🎉
