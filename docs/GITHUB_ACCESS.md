# GitHub authorization setup

The original 404 was resolved by installing **ChatGPT Codex Connector**, published by OpenAI, on the repository owner account and selecting this repository. Signing into GitHub from ChatGPT and installing the GitHub App are separate authorization steps.

1. Open https://github.com/apps/chatgpt-codex-connector/installations/new in a browser.
2. Sign into GitHub as the repository owner, `rajuerladinny`, and select that account.
3. Choose **Only select repositories**, then select `ai-autonomous-testing-agent`.
4. Review the requested permissions, then click Install, Save or Authorize as shown. Publishing requires repository contents and pull-request write capabilities.
5. If GitHub shows an existing installation, inspect its repository selection and save any changes.

Installed apps can also be inspected at https://github.com/settings/installations. Keep the repository private. Do not paste passwords, personal access tokens, API keys or GitHub authorization codes into chat or commit them to the repository.

In the ChatGPT interface used during setup, connections are under **Plugins → GitHub**. The **Allow low-risk actions** setting controls ChatGPT approval behavior; it does not select repositories or grant the GitHub App access to them.

After authorization, verify the actual installation account and private repository read access. Create a feature branch from the existing main history and publish the intended commit to verify write access. Read the resulting commit back before opening the pull request. User-level `push` metadata alone is not proof of integration write access.
