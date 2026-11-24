#!/usr/bin/env node
import {
  readFile,
  writeFile,
} from 'node:fs/promises';
import {
  createGitHubClient,
  GitHubRepoHost,
  ProjectBoard,
} from '@boardwright/github';
import { runProgram } from './program.ts';

// The composition root: the only module that touches the process, the file system and the token.
process.exitCode = await runProgram(
  process.argv.slice(2),
  {
    variables: process.env,
    readFile: (path) => readFile(
      path,
      'utf8',
    ).catch((error: unknown) => {
      if (
        error instanceof Error
        && 'code' in error
        && error.code === 'ENOENT'
      ) {
        return undefined;
      }

      throw error;
    }),
    createFile: (
      path,
      text,
    ) => writeFile(
      path,
      text,
      { flag: 'wx' },
    ).then(
      () => true,
      (error: unknown) => {
        if (
          error instanceof Error
          && 'code' in error
          && error.code === 'EEXIST'
        ) {
          return false;
        }

        throw error;
      },
    ),
    stdout: (text) => {
      process.stdout.write(`${text}\n`);
    },
    stderr: (text) => {
      process.stderr.write(`${text}\n`);
    },
    connect: (
      config,
      token,
    ) => {
      const client = createGitHubClient({ token });

      return {
        board: new ProjectBoard(
          client,
          config.project,
        ),
        repoHost: new GitHubRepoHost(client),
      };
    },
  },
);
