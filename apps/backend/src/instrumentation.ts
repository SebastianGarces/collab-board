// LangChain >= 0.3 backgrounds callbacks by default; force synchronous
// execution so spans are ready when we flush after an AI command.
process.env.LANGCHAIN_CALLBACKS_BACKGROUND = "false";
