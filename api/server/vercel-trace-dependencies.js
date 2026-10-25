/**
 * Vercel's Node file tracer cannot follow the `~` aliases configured by
 * module-alias. Resolve (without loading) the packages used by backend files
 * reachable only through those aliases so the function artifact includes them.
 */
require.resolve('@azure/search-documents');
require.resolve('@google/genai');
require.resolve('@microsoft/microsoft-graph-client');
require.resolve('@node-saml/passport-saml');
require.resolve('bcryptjs');
require.resolve('handlebars');
require.resolve('nodemailer');
require.resolve('openai');
require.resolve('openid-client');
require.resolve('passport-apple');
require.resolve('passport-discord');
require.resolve('passport-facebook');
require.resolve('passport-github2');
require.resolve('passport-google-oauth20');
require.resolve('passport-jwt');
require.resolve('passport-ldapauth');
require.resolve('passport-local');
require.resolve('zod-to-json-schema');
