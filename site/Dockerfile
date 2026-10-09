FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public_html/ /usr/share/nginx/html/
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 8080
