# Commit Message
**HIGHEST PRIORITY: All commit messages MUST be written in English.**

The commit message must be clear and concise, describing the change made. It must follow the format: `type: description` always in English. Examples:
- `feat: add login feature`
- `fix: correct user endpoint`
- `docs: update installation instructions`
- `refactor: improve button reusability`
- `style: adjust header spacing`

# Never comment in the code
Comments should only be added when explicitly requested. Do not insert comments automatically.

# Never create, rename, or delete files without explicit need
Structural changes to the project should only occur upon direct instruction. Do not modify the structure without authorization.

# Correct surgically
Change only what is strictly necessary. Do not rewrite entire sections if only a small part requires correction.

# Preserve the original style and structure of the code
Respect the existing indentation, naming, and organizational standards of the project. Do not apply automatic reformats.

# Avoid generic suggestions
Provide specific and contextualized solutions. Do not generalize or offer unsolicited alternatives.

# Analyze the code within the frontend and backend src folders to identify areas for improvement
Whenever suggesting improvements, analyze the code within the frontend and backend src folders. Focus on optimizations that respect existing logic and improve performance or readability.

# Avoid code duplication and always seek component reuse.

Whenever possible, propose reusing existing components instead of creating new ones. This helps keep the code clean and reduces project complexity.

# Whenever suggesting changes, ensure the code is up-to-date with the latest dependencies and best practices.
Before proposing any modifications, verify that the code is aligned with the latest versions of dependencies and best practices. This ensures that the changes are compatible and take advantage of the latest available features.

# Whenever possible, use the 'yarn build' command to ensure that the changes are correct and optimized.
Whenever suggesting changes, run the `yarn build:tsc` command to ensure that the modifications are correct and optimized. This helps identify compilation problems and ensures that the code is production-ready.

# Always run 'yarn lint:fix' when modifying files.
Whenever you make changes to files, run the `yarn lint:fix` command to automatically correct formatting and style issues. This helps maintain code consistency and avoid common errors.

# Commit Type
When creating a commit, always include a _type_ and a _scope_ (optional) in the commit message. The `_type_` must be one of the following types, and the `_scope_` must be a brief description of what was changed or added. The message must follow the format: `type(scope): description`.

The `_type_` can be one of these types:

| Prefix   | Description              | Meaning                                                                                                         |
|----------|--------------------------|-----------------------------------------------------------------------------------------------------------------|
| feat     | Features                 | A new feature                                                                                                   |
| fix      | Bug Fixes                | A bug fix                                                                                                       |
| docs     | Documentation            | Documentation changes only                                                                                      |
| style    | Styles                   | Styling changes                                                                                                 |
| refactor | Code Refactoring         | A code change that neither fixes a bug nor adds a feature                                                       |
| perf     | Performance Improvements | A code change that improves performance                                                                         |
| test     | Tests                    | Adding missing tests or fixing existing tests                                                                   |
| build    | Builds                   | Changes that affect the build system or external dependencies (examples of scopes: gulp, broccoli, npm)         |
| ci       | Continuous Integration   | Changes to our CI configuration files and scripts (examples of scopes: Travis, Circle, BrowserStack, SauceLabs) |
| chore    | Tasks                    | Other changes that do not modify source code or test files                                                      |
| revert   | Revert                   | Reverts a previous commit                                                                                       |
