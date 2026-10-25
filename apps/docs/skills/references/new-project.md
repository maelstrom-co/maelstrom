# Start a new application

Use this branch after the user chooses a new app. Establish the product goal,
destination directory, and plan-only or implementation authority from the request.
Inspect the destination and its parent instructions before creating files. Use an
empty destination; ask for another path if creating the app would overwrite work.

For React, start from the [React starter repository](https://github.com/maelstrom-co/react-starter).
Clone the example into the approved empty destination and read its README and
package scripts. Use the GitHub template action when the user requests a new
GitHub repository.
The starter pins public npm packages at 0.1.0 and
runs a real Engine with a deterministic local planner. It needs Bun and no provider
key. Describe this as local integration verification, not a live model test.

For plan-only work, describe the selected starter and checks without creating
files, installing dependencies, or starting services. For an authorized
implementation, install with the project's package manager, run the starter's
checks, start it locally, and observe its greeting capability after an intent.
Then apply the onboarding procedure to the user's smallest useful product goal.

For a different framework or an existing preferred scaffold, inspect its actual
setup and installed package APIs. Use the framework-independent client where
appropriate. Do not promise a framework binding that is not shipped.

Connect a live model only when the goal needs it and the provider is selected.
Keep provider credentials on the server. Record provider/network checks separately
from the deterministic local run. Deployment and paid provider calls require
authorization for those actions.
