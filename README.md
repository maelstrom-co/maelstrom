# Maelstrom

The idea is simple, new applications will be controlled both by traditional UI interactions like buttons
and links but also by talking/texting with AI agents.

Our library Maelstrom will be the backbone of how this kind of applications are built, providing balance between curated widgets and AI-driven interactions.

The components for now are:

- The buoys: These are self-contained, isolated UI components that are design and implemented by the creators of the app. Similar to widgets,
  the buoys will provide specific functionality to the users, offering a human curated UI/UX and functionality.
  They will have a standard interface to communicate with the Maelstrom agent.
- The Chart: this is the canvas where the buoys will be placed and arranged.
- Maelstrom: the llm agent that will orchestrate the buoys and provide the AI-driven interactions. It will decide when and where a buoy is displayed, what data is sent to it, and how to interact with them.
