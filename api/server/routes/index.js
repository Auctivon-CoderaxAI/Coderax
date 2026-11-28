const accessPermissions = require('./accessPermissions');
const apiMeta = require('./apiMeta');
const assistants = require('./assistants');
const categories = require('./categories');
const adminAuth = require('./admin/auth');
const adminConfig = require('./admin/config');
const adminCodeEnvironments = require('./admin/code');
const codeEnvironments = require('./code-environments');
const adminLangfuse = require('./admin/langfuse');
const adminCyVox = require('./admin/cyvox');
const adminGrants = require('./admin/grants');
const adminGroups = require('./admin/groups');
const adminRoles = require('./admin/roles');
const adminSkills = require('./admin/skills');
const adminUsers = require('./admin/users');
const adminAuditLog = require('./admin/audit');
const endpoints = require('./endpoints');
const staticRoute = require('./static');
const messages = require('./messages');
const memories = require('./memories');
const presets = require('./presets');
const projects = require('./projects');
const games = require('./games');
const research = require('./research');
const prompts = require('./prompts');
const schedules = require('./schedules');
const workflows = require('./workflows');
const workflowEngine = require('./workflowEngine');
const skills = require('./skills');
const balance = require('./balance');
const actions = require('./actions');
const apiKeys = require('./apiKeys');
const banner = require('./banner');
const openapi = require('./openapi');
const search = require('./search');
const models = require('./models');
const providers = require('./providers');
const convos = require('./convos');
const traces = require('./traces');
const config = require('./config');
const agents = require('./agents');
const roles = require('./roles');
const oauth = require('./oauth');
const files = require('./files');
const share = require('./share');
const tags = require('./tags');
const auth = require('./auth');
const keys = require('./keys');
const user = require('./user');
const mcp = require('./mcp');
const rum = require('./rum');
const insights = require('./insights');
const studio = require('./studio');

module.exports = {
  apiMeta,
  insights,
  studio,
  rum,
  mcp,
  auth,
  adminAuth,
  adminConfig,
  adminCodeEnvironments,
  codeEnvironments,
  adminLangfuse,
  adminCyVox,
  adminGrants,
  adminGroups,
  adminRoles,
  adminSkills,
  adminUsers,
  adminAuditLog,
  keys,
  apiKeys,
  user,
  tags,
  roles,
  oauth,
  files,
  share,
  banner,
  openapi,
  agents,
  convos,
  traces,
  search,
  config,
  models,
  providers,
  prompts,
  projects,
  games,
  research,
  schedules,
  workflows,
  workflowEngine,
  skills,
  actions,
  presets,
  balance,
  messages,
  memories,
  endpoints,
  assistants,
  categories,
  staticRoute,
  accessPermissions,
};
