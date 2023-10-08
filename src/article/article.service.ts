import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import slugify from 'slugify';
// import * as lodash from 'lodash';

import { Article } from './article.entity';
import { CreateArticleDto } from './dto/create-article.dto';
import { User } from 'src/user/user.entity';
import { Tag } from 'src/tag/tag.entity';
import { UpdateArticleDto } from './dto/update-article.dto';
import { Comment } from './comment.entity';
import { CreateCommentDto } from './dto/create-comment.dto';

@Injectable()
export class ArticleService {
  constructor(
    @InjectRepository(Article)
    private articleRepository: Repository<Article>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Tag)
    private tagRepository: Repository<Tag>,
    @InjectRepository(Comment)
    private commentRepository: Repository<Comment>,
  ) {}

  async feed(userId, query) {
    const limit = parseInt(query.limit) || 20;
    const offset = parseInt(query.offset) || 0;

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: {
        followings: true,
      },
    });
    const userFollowings = user.followings.map((u) => u.username);
    const articleInFeed = await this.articleRepository.find({
      where: {
        author: In(userFollowings),
      },
      order: { created: 'DESC' },
      skip: offset,
      take: limit,
    });
    return articleInFeed;
  }

  async getAll(query) {
    const { tag, author, favorited } = query;
    const limit = parseInt(query.limit) || 20;
    const offset = parseInt(query.offset) || 0;

    const articleQb = this.articleRepository
      .createQueryBuilder('article')
      .leftJoinAndSelect('article.tags', 'tag')
      .leftJoinAndSelect('article.author', 'author');

    articleQb.where('1=1');

    if (tag) {
      articleQb.andWhere((qb) => {
        return (
          'article.slug IN' +
          qb
            .subQuery()
            .select('article.slug')
            .from(Article, 'article')
            .leftJoin('article.tags', 'tag')
            .where('tag = :tagName', { tagName: tag })
            .getQuery()
        );
      });
    }
    if (author) {
      articleQb.andWhere('author.username = :username', { username: author });
    }
    if (favorited) {
      const userFavorite = await this.userRepository.findOne({
        where: { username: favorited },
        relations: {
          favorite: true,
        },
      });
      const ids = userFavorite.favorite.map((article) => article.id);
      articleQb.andWhere('article.id IN (:...ids)', { ids });
    }
    articleQb.orderBy('article.created', 'DESC');
    articleQb.skip(offset);
    articleQb.take(limit);
    return await articleQb.getMany();
  }

  async getArticleBySlug(userId: string | null, slug: string) {
    const article = await this.articleRepository.findOne({
      where: {
        slug,
      },
      relations: {
        author: true,
        favoriteBy: true,
        tags: true,
      },
    });
    return this.createArticleData(userId, article);
  }

  async createArticle(userId: string, createArticleDto: CreateArticleDto) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: {
        authorOf: true,
      },
    });
    const listTagEntity = await this.convertTagNameToTagEntity(
      createArticleDto.tagList,
    );
    const newArticle = this.articleRepository.create({
      ...createArticleDto,
      slug: slugify(createArticleDto.title),
      tags: listTagEntity,
    });
    user.authorOf.push(newArticle);
    await this.userRepository.save(user);
    return await this.getArticleBySlug(userId, newArticle.slug);
  }

  async updateArticle(
    userId: string,
    slug: string,
    updateArticleDto: UpdateArticleDto,
  ) {
    const article = await this.articleRepository.findOne({
      where: {
        slug,
      },
      relations: {
        author: true,
        tags: true,
      },
    });
    if (article.author.id != userId) {
      throw new UnauthorizedException();
    }
    const newSlug = updateArticleDto.title
      ? slugify(updateArticleDto.title)
      : article.slug;
    article.title = updateArticleDto.title;
    article.description = updateArticleDto.description;
    article.body = updateArticleDto.body;
    article.tags = await this.convertTagNameToTagEntity(
      updateArticleDto.tagList,
    );
    article.slug = newSlug;
    await this.articleRepository.save(article);
    return await this.getArticleBySlug(userId, newSlug);
  }

  async deleteArticle(userId: string, slug: string) {
    const article = await this.articleRepository.findOne({
      where: {
        slug,
      },
      relations: {
        author: true,
      },
    });
    if (userId !== article.author.id) {
      throw new UnauthorizedException();
    }
    await this.articleRepository.delete({ slug });
    return `deleted ${slug}`;
  }

  async createComment(
    userId: string,
    slug: string,
    createCommentDto: CreateCommentDto,
  ) {
    const user = await this.userRepository.findOne({
      where: {
        id: userId,
      },
      select: ['id', 'username', 'bio', 'image'],
    });
    const article = await this.articleRepository.findOne({
      where: {
        slug,
      },
      select: ['id'],
    });
    // const comment = this.commentRepository.create(createCommentDto);
    const comment = new Comment();
    comment.body = createCommentDto.body;
    comment.author = user;
    comment.article = article;
    await this.commentRepository.save(comment);
    return comment;
  }

  async getComments(userId: string, slug: string) {
    const user = userId
      ? await this.userRepository.findOne({
          where: { id: userId },
          relations: {
            followings: true,
          },
        })
      : null;
    const article = await this.articleRepository.findOne({
      where: { slug },
      relations: {
        comments: {
          author: true,
        },
      },
    });
    const userFollowings = user ? user.followings.map((u) => u.username) : [];
    const comments = article.comments.map((c) => {
      const temp: any = { ...c };
      temp.author.following = userFollowings.includes(temp.author.username);
      return temp;
    });
    return { comments };
  }

  async deleteComment(userId: string, slug: string, commentId: string) {
    const comment = await this.commentRepository.findOne({
      where: {
        id: commentId,
      },
      relations: {
        author: true,
      },
    });
    if (userId !== comment.author.id) {
      throw new UnauthorizedException();
    }
    await this.commentRepository.delete({ id: commentId });
    return `delete comment ${commentId} of article ${slug}`;
  }

  async favorite(userId: string, slug: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: {
        favorite: true,
      },
    });
    const article = await this.articleRepository.findOne({
      where: { slug },
      relations: {
        author: true,
      },
      select: {
        author: {
          username: true,
          bio: true,
          image: true,
        },
      },
    });
    user.favorite.push(article);
    await this.userRepository.save(user);
    return { article };
  }

  async unFavorite(userId: string, slug: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: {
        favorite: true,
      },
    });
    const article = await this.articleRepository.findOne({
      where: { slug },
      relations: {
        author: true,
      },
      select: {
        author: {
          username: true,
          bio: true,
          image: true,
        },
      },
    });
    user.favorite = user.favorite.filter((a) => a.slug != slug);
    await this.userRepository.save(user);
    return { article };
  }

  private async createArticleData(userId: string, article: Article) {
    const articleData = {
      ...article,
      tagList: article.tags.map((t) => t.name),
      favorited: article.favoriteBy.find((u) => u.id === userId),
      favoritesCount: article.favoriteBy.length,
    };
    delete articleData.id;
    delete articleData.tags;
    delete articleData.author.id;
    delete articleData.author.password;
    delete articleData.author.email;
    return articleData;
  }

  private async convertTagNameToTagEntity(tagList: string[]) {
    const listTagEntity = await Promise.all(
      tagList.map(async (t) => {
        const tag =
          (await this.tagRepository.findOne({
            where: {
              name: t,
            },
          })) ?? this.tagRepository.create({ name: t });
        return tag;
      }),
    );
    return listTagEntity;
  }
}
