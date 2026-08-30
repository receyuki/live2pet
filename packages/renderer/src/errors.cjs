class RendererContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RendererContractError';
    this.code = code;
    this.details = details;
  }
}

module.exports = { RendererContractError };
