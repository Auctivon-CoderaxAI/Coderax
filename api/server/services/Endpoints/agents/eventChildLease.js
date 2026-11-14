const coderaxApi = require('@coderax/api');
const { GenerationJobManager } = coderaxApi;
const {
  acquireSubagentThreadLease,
  renewSubagentThreadLease,
  releaseSubagentThreadLease,
} = require('~/models');

let acquireLease;

function acquireEventChildGenerationLease(input) {
  acquireLease ??= coderaxApi.createEventChildGenerationLeaseAcquirer({
    methods: {
      acquireSubagentThreadLease,
      renewSubagentThreadLease,
      releaseSubagentThreadLease,
    },
    abortGeneration: (streamId, options) => GenerationJobManager.abortJob(streamId, options),
  });

  return acquireLease(input);
}

module.exports = { acquireEventChildGenerationLease };
