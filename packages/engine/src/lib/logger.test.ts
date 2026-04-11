import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { consoleLogger } from './logger.js';

describe('consoleLogger', () => {
  const originalConsole = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  beforeEach(() => {
    console.debug = mock(() => {});
    console.info = mock(() => {});
    console.warn = mock(() => {});
    console.error = mock(() => {});
  });

  afterEach(() => {
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  test('debug logs with [engine] prefix', () => {
    consoleLogger.debug('test message');
    expect(console.debug).toHaveBeenCalledWith('[engine] test message');
  });

  test('info logs with [engine] prefix', () => {
    consoleLogger.info('test message');
    expect(console.info).toHaveBeenCalledWith('[engine] test message');
  });

  test('warn logs with [engine] prefix', () => {
    consoleLogger.warn('test message');
    expect(console.warn).toHaveBeenCalledWith('[engine] test message');
  });

  test('error logs with [engine] prefix', () => {
    consoleLogger.error('test message');
    expect(console.error).toHaveBeenCalledWith('[engine] test message');
  });

  test('passes data object when provided', () => {
    const data = { key: 'value' };
    consoleLogger.info('with data', data);
    expect(console.info).toHaveBeenCalledWith('[engine] with data', data);
  });

  test('error passes error and data when provided', () => {
    const cause = new Error('boom');
    const data = { context: 'test' };
    consoleLogger.error('failed', cause, data);
    expect(console.error).toHaveBeenCalledWith('[engine] failed', cause, data);
  });

  test('does not pass trailing undefined arguments', () => {
    consoleLogger.debug('clean');
    expect(console.debug).toHaveBeenCalledWith('[engine] clean');
  });
});
