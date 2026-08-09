ARG ELASTIC_BASE_IMAGE=docker.m.daocloud.io/elasticsearch:9.3.3

FROM ${ELASTIC_BASE_IMAGE}

ARG ELASTIC_VERSION=9.3.3
ARG ANALYSIS_IK_URL=https://get.infini.cloud/elasticsearch/analysis-ik/${ELASTIC_VERSION}

RUN bin/elasticsearch-plugin install --batch "${ANALYSIS_IK_URL}"
