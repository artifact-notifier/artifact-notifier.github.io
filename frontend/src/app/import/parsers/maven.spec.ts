import { parsePom } from './maven';

const SPRING_BOOT_POM = `<?xml version="1.0" encoding="UTF-8"?>\r
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>4.1.2</version>
  </parent>
  <groupId>com.example</groupId>
  <artifactId>demo</artifactId>
  <version>\${revision}</version>
  <properties>
    <revision>1.0.0-SNAPSHOT</revision>
    <java.version>25</java.version>
    <mapstruct.version>1.6.3</mapstruct.version>
    <cloud.version>\${cloud.base}.1</cloud.version>
    <cloud.base>2026.0</cloud.base>
  </properties>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-dependencies</artifactId>
        <version>\${cloud.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
      <dependency>
        <groupId>com.google.guava</groupId>
        <artifactId>guava</artifactId>
        <version>33.4.0-jre</version>
      </dependency>
    </dependencies>
  </dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.mapstruct</groupId>
      <artifactId>mapstruct</artifactId>
      <version>\${mapstruct.version}</version>
    </dependency>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>demo-api</artifactId>
      <version>\${project.version}</version>
    </dependency>
    <dependency>
      <groupId>jakarta.servlet</groupId>
      <artifactId>jakarta.servlet-api</artifactId>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>org.projectlombok</groupId>
      <artifactId>lombok</artifactId>
      <optional>true</optional>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.example</groupId>
      <artifactId>ranged</artifactId>
      <version>[1.0,2.0)</version>
    </dependency>
    <dependency>
      <groupId>org.example</groupId>
      <artifactId>unknown-version</artifactId>
      <version>\${not.defined}</version>
    </dependency>
    <dependency>
      <groupId>\${some.group}</groupId>
      <artifactId>broken</artifactId>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
      <plugin>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.5.2</version>
      </plugin>
    </plugins>
  </build>
  <profiles>
    <profile>
      <dependencies>
        <dependency><groupId>x</groupId><artifactId>profile-only</artifactId></dependency>
      </dependencies>
    </profile>
  </profiles>
</project>`;

describe('parsePom', () => {
  const { dependencies, warnings } = parsePom(SPRING_BOOT_POM, 'back/pom.xml');
  const find = (coords: string) => dependencies.find((d) => d.coordinates === coords);

  it('reads the parent, imported BOMs, dependencies and plugins (not managed versions nor profiles)', () => {
    expect(dependencies.map((d) => `${d.scope} ${d.coordinates}`)).toEqual([
      'parent org.springframework.boot:spring-boot-starter-parent',
      'prod org.springframework.boot:spring-boot-starter-web',
      'prod org.mapstruct:mapstruct',
      'prod com.example:demo-api',
      'provided jakarta.servlet:jakarta.servlet-api',
      'optional org.projectlombok:lombok',
      'test org.springframework.boot:spring-boot-starter-test',
      'prod org.example:ranged',
      'prod org.example:unknown-version',
      'bom org.springframework.cloud:spring-cloud-dependencies',
      'plugin org.springframework.boot:spring-boot-maven-plugin',
      'plugin org.apache.maven.plugins:maven-surefire-plugin',
    ]);
  });

  it('gives literal versions as exact', () => {
    expect(find('org.springframework.boot:spring-boot-starter-parent')).toMatchObject({
      declared: '4.1.2',
      version: '4.1.2',
    });
  });

  it('resolves properties, nested ones and project.version', () => {
    expect(find('org.mapstruct:mapstruct')?.version).toBe('1.6.3');
    expect(find('org.springframework.cloud:spring-cloud-dependencies')?.version).toBe('2026.0.1');
    expect(find('com.example:demo-api')?.version).toBe('1.0.0-SNAPSHOT');
  });

  it('leaves managed, ranged and unresolved versions without an exact version', () => {
    expect(find('org.springframework.boot:spring-boot-starter-web')).not.toHaveProperty('declared');
    expect(find('org.example:ranged')).toMatchObject({ declared: '[1.0,2.0)' });
    expect(find('org.example:ranged')?.version).toBeUndefined();
    expect(find('org.example:unknown-version')).toMatchObject({ declared: '${not.defined}' });
    expect(find('org.example:unknown-version')?.version).toBeUndefined();
  });

  it('skips unresolved coordinates with a warning', () => {
    expect(warnings).toEqual(['back/pom.xml: dependency ${some.group}:broken has unresolved coordinates, skipped']);
  });

  it('works without namespace nor properties', () => {
    const { dependencies: deps } = parsePom(
      '<project><dependencies><dependency><groupId>g</groupId><artifactId>a</artifactId><version>1</version></dependency></dependencies></project>',
      'pom.xml',
    );
    expect(deps).toEqual([{ ecosystem: 'MAVEN', coordinates: 'g:a', declared: '1', version: '1', scope: 'prod' }]);
  });

  it('rejects malformed XML and non-POM documents', () => {
    expect(() => parsePom('<project><dependencies>', 'pom.xml')).toThrow('invalid pom.xml');
    expect(() => parsePom('<settings/>', 'pom.xml')).toThrow('invalid pom.xml');
  });
});
