const pgid = Number(process.argv[2]);
if (!Number.isSafeInteger(pgid) || pgid < 1) process.exit(2);
const exists = () => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
};
try {
  process.kill(-pgid, 'SIGKILL');
} catch (error) {
  if (error.code !== 'ESRCH') process.exit(2);
}
const until = performance.now() + 1500;
while (exists() && performance.now() < until)
  await new Promise((resolve) => setTimeout(resolve, 20));
process.exit(exists() ? 2 : 0);
