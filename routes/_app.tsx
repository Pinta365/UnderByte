import { define } from "../utils.ts";

export default define.page(function App({ Component }) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://track.webpulseanalytics.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://track.webpulseanalytics.com;"
        />
        <meta http-equiv="X-Content-Type-Options" content="nosniff" />
        <meta
          http-equiv="Referrer-Policy"
          content="strict-origin-when-cross-origin"
        />
        <script
          async
          src="https://track.webpulseanalytics.com/client/694eb47b1b3236cecf706b38"
          type="module"
        >
        </script>
        <title>UnderByte</title>
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
});
