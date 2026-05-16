ARG NEO4J_BASE_IMAGE=digital-human-agent-elasticsearch-ik:9.3.3
FROM ${NEO4J_BASE_IMAGE}

ARG NEO4J_VERSION=5.26.26

ENV NEO4J_HOME=/var/lib/neo4j
ENV JAVA_HOME=/usr/share/elasticsearch/jdk
ENV PATH="${JAVA_HOME}/bin:${NEO4J_HOME}/bin:${PATH}"

USER root

COPY docker/neo4j/vendor/neo4j-community-${NEO4J_VERSION}/ ${NEO4J_HOME}/
COPY docker/neo4j/docker-entrypoint.sh /usr/local/bin/dha-neo4j-entrypoint

RUN mkdir -p /data /logs /plugins /import /licenses \
  && cp ${NEO4J_HOME}/labs/apoc-${NEO4J_VERSION}-core.jar /plugins/apoc-${NEO4J_VERSION}-core.jar \
  && rm -rf ${NEO4J_HOME}/data ${NEO4J_HOME}/logs ${NEO4J_HOME}/plugins ${NEO4J_HOME}/import ${NEO4J_HOME}/licenses \
  && ln -s /data ${NEO4J_HOME}/data \
  && ln -s /logs ${NEO4J_HOME}/logs \
  && ln -s /plugins ${NEO4J_HOME}/plugins \
  && ln -s /import ${NEO4J_HOME}/import \
  && ln -s /licenses ${NEO4J_HOME}/licenses \
  && chmod +x /usr/local/bin/dha-neo4j-entrypoint \
  && chown -R 1000:0 ${NEO4J_HOME} /data /logs /plugins /import /licenses \
  && chmod -R g=u ${NEO4J_HOME} /data /logs /plugins /import /licenses

USER 1000
WORKDIR ${NEO4J_HOME}

EXPOSE 7474 7687

ENTRYPOINT ["dha-neo4j-entrypoint"]
CMD ["neo4j", "console"]
