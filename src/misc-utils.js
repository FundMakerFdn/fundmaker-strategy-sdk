export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const mm = (a, b) => [Math.min(a, b), Math.max(a, b)];

export const handle = (func, errStr) => {
  // Wrap an async function into the error handler
  return async (...args) => {
    try {
      return func(...args);
    } catch (err) {
      console.error("Error", errStr, err.message);
      throw err;
    }
  };
};
