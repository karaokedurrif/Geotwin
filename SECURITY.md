# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of GeoTwin Engine seriously. If you discover a security vulnerability, please follow these steps:

### 1. **Do Not** Open a Public Issue

Please do not open a public GitHub issue for security vulnerabilities.

### 2. Report Privately

Send details to: **[Add security email]**

Include:
- Type of vulnerability
- Affected components/versions
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### 3. Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Fix Timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 1 week
  - Medium: 2 weeks
  - Low: Next release

### 4. Disclosure Policy

- We will acknowledge your report
- We will investigate and validate
- We will develop and test a fix
- We will release a security update
- We will publicly acknowledge your contribution (if desired)

## Known Security Limitations (MVP)

⚠️ This is an MVP release with the following known limitations:

- **No Authentication**: Anyone can upload files and create twins
- **No Rate Limiting**: API endpoints are not rate-limited
- **Open CORS**: All origins are allowed
- **No Input Validation**: Minimal file validation
- **Local Storage**: Data stored on server filesystem
- **No Encryption**: Data not encrypted at rest
- **No Audit Logs**: No tracking of user actions

**These are planned for production release.**

## Security Best Practices for Deployment

If deploying the MVP:

1. **Use a Firewall**: Restrict access to API endpoints
2. **Use HTTPS**: Always use TLS/SSL in production
3. **Set Environment Variables**: Never commit secrets
4. **Limit File Size**: Configure reverse proxy limits
5. **Monitor Logs**: Watch for suspicious activity
6. **Regular Updates**: Keep dependencies updated
7. **Backup Data**: Regular backups of `/data` directory

## Production Security Checklist

Before production deployment:

- [ ] Implement authentication (OAuth2/JWT)
- [ ] Add API rate limiting
- [ ] Restrict CORS to specific domains
- [ ] Validate and sanitize all inputs
- [ ] Scan uploaded files for malware
- [ ] Use environment secrets manager
- [ ] Enable HTTPS/TLS
- [ ] Add security headers (CSP, HSTS, etc.)
- [ ] Implement audit logging
- [ ] Set up monitoring and alerting
- [ ] Regular security audits
- [ ] Dependency vulnerability scanning
- [ ] SQL injection prevention (when using DB)
- [ ] XSS protection
- [ ] CSRF protection

## Dependencies

We use:
- `npm audit` / `pnpm audit` for dependency scanning
- GitHub Dependabot for automated updates
- Regular manual review of critical dependencies

## Contact

For security concerns: **[Add security contact]**

For general issues: https://github.com/karaokedurrif/Geotwin/issues

---

**Thank you for helping keep GeoTwin secure!**
