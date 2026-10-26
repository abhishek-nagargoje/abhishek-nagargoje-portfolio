// @mode all
// Recovery sweep settings. The sweep only releases leases that expired more
// than grace_minutes ago, so a job that is still running is never reset.
return [{ json: { settings: {
  owner: 'recovery-' + String($execution.id),
  grace_minutes: 10,
  max_recovery_attempts: 3,
  plagiarism_hash_valid_hours: 6.5,
} } }];
