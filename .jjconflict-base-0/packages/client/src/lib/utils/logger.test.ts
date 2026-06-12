import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { Logger } from './logger.js';

describe('Logger', () => {
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalLog = console.log;
  const originalDebug = console.debug;

  let mockWarn: ReturnType<typeof mock>;
  let mockError: ReturnType<typeof mock>;
  let mockLog: ReturnType<typeof mock>;
  let mockDebug: ReturnType<typeof mock>;

  beforeEach(() => {
    mockWarn = mock();
    mockError = mock();
    mockLog = mock();
    mockDebug = mock();
    console.warn = mockWarn;
    console.error = mockError;
    console.log = mockLog;
    console.debug = mockDebug;
  });

  afterEach(() => {
    console.warn = originalWarn;
    console.error = originalError;
    console.log = originalLog;
    console.debug = originalDebug;
  });

  describe('when debug is disabled', () => {
    it('should suppress debug messages', () => {
      const logger = new Logger(false);
      logger.debug('test');
      expect(mockDebug).not.toHaveBeenCalled();
    });

    it('should suppress info messages', () => {
      const logger = new Logger(false);
      logger.info('test');
      expect(mockLog).not.toHaveBeenCalled();
    });

    it('should always log warnings regardless of debug flag', () => {
      const logger = new Logger(false);
      logger.warn('something unexpected happened');
      expect(mockWarn).toHaveBeenCalledTimes(1);
    });

    it('should always log errors regardless of debug flag', () => {
      const logger = new Logger(false);
      logger.error('something broke');
      expect(mockError).toHaveBeenCalledTimes(1);
    });
  });

  describe('when debug is enabled', () => {
    it('should log all levels', () => {
      const logger = new Logger(true, 'Test');
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');

      expect(mockDebug).toHaveBeenCalledTimes(1);
      expect(mockLog).toHaveBeenCalledTimes(1);
      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(mockError).toHaveBeenCalledTimes(1);
    });
  });

  describe('namespace prefix', () => {
    it('should use custom namespace in prefix', () => {
      const logger = new Logger(true, 'MyModule');
      logger.info('hello');
      expect(mockLog).toHaveBeenCalledWith('[MyModule]', 'hello');
    });

    it('should default to Maelstrom namespace', () => {
      const logger = new Logger(true);
      logger.info('hello');
      expect(mockLog).toHaveBeenCalledWith('[Maelstrom]', 'hello');
    });
  });
});
