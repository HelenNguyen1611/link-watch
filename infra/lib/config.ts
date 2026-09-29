/** Cấu hình cố định của môi trường LinkWatch (không chứa bí mật). */
export const config = {
  account: '131746731277',
  region: 'ap-southeast-1',
  domainName: 'watch.hueai.net',
  /** Chứng chỉ ACM ở us-east-1 (bắt buộc cho CloudFront), đã Issued 29/09/2026 */
  certificateArn:
    'arn:aws:acm:us-east-1:131746731277:certificate/2a904427-bfec-4ac1-9970-34b8d41cf26f',
  /** Repo + nhánh được phép deploy qua GitHub Actions OIDC */
  github: {
    owner: 'HelenNguyen1611',
    repo: 'link-watch',
    branch: 'main',
    /** ID bất biến GitHub gắn vào claim "sub" (lấy từ CloudTrail 29/09/2026) */
    ownerId: '126633948',
    repoId: '1394505495',
  },
} as const;
